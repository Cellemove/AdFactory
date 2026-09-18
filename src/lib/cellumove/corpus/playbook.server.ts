import "server-only";
import { createHash } from "node:crypto";

import type { AdBeatRow, CompetitorAdRow, CorpusBrandPlaybookRow, CorpusExtractRunRow, CorpusTranscriptSegmentRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { CORPUS_ENGINE_VERSION, CORPUS_TAXONOMY_VERSION, MEDIA_FAILED, MINE_MIN_SUPPORT, VISUAL_CHANNEL, type TranscriptChannel } from "./constants";
import { playbookId } from "./ids";
import { mineCorpus } from "./mine";
import { buildPlaybook, PLAYBOOK_ENGINE_VERSION, type BrandPlaybook, type PlaybookAd } from "./playbook";
import { loadTaxonomy } from "./taxonomy.server";
import { loadAllRows } from "./pagination";

export type LatestPlaybook = { row: CorpusBrandPlaybookRow; playbook: BrandPlaybook };

/**
 * One brand's ads with everything the playbook quotes: the beats, the word
 * lines (voiceover + on-screen) and the visual notes from the same transcript
 * run the beats were extracted from.
 */
async function loadPlaybookAds(brand: string, taxonomyVersion: string): Promise<Array<PlaybookAd & { extractRunId: string }>> {
  const ads = await supabase.from("CompetitorAd").select("*").eq("brandName", brand).eq("corpusIncluded", true).eq("mediaType", "video");
  if (ads.error) throw new Error(ads.error.message);
  const adRows = (ads.data ?? []) as CompetitorAdRow[];
  if (!adRows.length) return [];
  const adIds = adRows.map((ad) => ad.id);

  const runs = await supabase.from("CorpusExtractRun").select("*").in("competitorAdId", adIds).eq("taxonomyVersion", taxonomyVersion).eq("status", "complete").order("createdAt", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  const latestByAd = new Map<string, CorpusExtractRunRow>();
  for (const run of (runs.data ?? []) as CorpusExtractRunRow[]) {
    if (!latestByAd.has(run.competitorAdId)) latestByAd.set(run.competitorAdId, run);
  }
  if (!latestByAd.size) return [];
  const runIds = [...latestByAd.values()].map((run) => run.id);
  const transcriptRunIds = [...new Set([...latestByAd.values()].map((run) => run.transcriptRunId))];

  const [beats, segments, media] = await Promise.all([
    loadAllRows((from, to) => supabase.from("AdBeat").select("*").in("runId", runIds).order("id").range(from, to)),
    loadAllRows((from, to) => supabase.from("CorpusTranscriptSegment").select("*").in("runId", transcriptRunIds).order("id").range(from, to)),
    supabase.from("AdMedia").select("competitorAdId, durationSec").in("competitorAdId", adIds),
  ]);
  if (media.error) throw new Error(media.error.message);

  const beatsByRun = new Map<string, AdBeatRow[]>();
  for (const beat of beats as AdBeatRow[]) beatsByRun.set(beat.runId, [...(beatsByRun.get(beat.runId) ?? []), beat]);
  const segmentsByRun = new Map<string, CorpusTranscriptSegmentRow[]>();
  for (const segment of segments as CorpusTranscriptSegmentRow[]) segmentsByRun.set(segment.runId, [...(segmentsByRun.get(segment.runId) ?? []), segment]);
  const durationByAd = new Map((media.data ?? []).map((row) => [row.competitorAdId, row.durationSec]));

  return adRows.flatMap((ad) => {
    const run = latestByAd.get(ad.id);
    if (!run) return [];
    const adBeats = beatsByRun.get(run.id) ?? [];
    if (!adBeats.length) return [];
    const adSegments = (segmentsByRun.get(run.transcriptRunId) ?? []).sort((a, b) => a.tStart - b.tStart || a.orderIndex - b.orderIndex);
    return [{
      id: ad.id,
      extractRunId: run.id,
      brand: ad.brandName,
      formatTag: ad.formatTag ?? null,
      angleTag: ad.angleTag ?? null,
      winnerScore: ad.winnerScore ?? null,
      durationSec: durationByAd.get(ad.id) ?? ad.durationSec ?? null,
      lines: adSegments.filter((segment) => segment.channel !== VISUAL_CHANNEL).map((segment) => ({ adId: ad.id, channel: segment.channel as TranscriptChannel, tStart: segment.tStart, text: segment.text })),
      visuals: adSegments.filter((segment) => segment.channel === VISUAL_CHANNEL).map((segment) => ({ tStart: segment.tStart, tEnd: segment.tEnd, text: segment.text })),
      beats: adBeats.map((beat) => ({ adId: ad.id, orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code, startSec: beat.startSec, endSec: beat.endSec, evidenceQuote: beat.evidenceQuote, channel: beat.channel })),
    }];
  });
}

export type SavePlaybookResult = { playbook: BrandPlaybook | null; written: boolean; adCount: number };

/** Build the brand's playbook from its extracted ads and store it; an unchanged corpus is a no-op. */
export async function buildAndSavePlaybook(brand: string, options: { taxonomyVersion?: string } = {}): Promise<SavePlaybookResult> {
  const taxonomyVersion = options.taxonomyVersion ?? CORPUS_TAXONOMY_VERSION;
  const ads = await loadPlaybookAds(brand, taxonomyVersion);
  if (!ads.length) return { playbook: null, written: false, adCount: 0 };
  const [taxonomy, state] = await Promise.all([
    loadTaxonomy(taxonomyVersion),
    supabase.from("CorpusAdState").select("mediaStatus").eq("brandName", brand).eq("corpusIncluded", true).eq("mediaType", "video"),
  ]);
  if (state.error) throw new Error(state.error.message);
  // Ads whose video the download stage gave up on can never reach the playbook;
  // counting them would leave the brand permanently short of its own total.
  const reachable = (state.data ?? []).filter((row) => !MEDIA_FAILED.has(row.mediaStatus ?? "")).length;
  // Derive patterns from exactly this snapshot's evidence; a previous report may be stale.
  const report = ads.length >= MINE_MIN_SUPPORT ? mineCorpus(ads, { taxonomyVersion, engineVersion: CORPUS_ENGINE_VERSION, cohort: "brand", cohortKey: brand, minSupport: MINE_MIN_SUPPORT }) : null;
  const totalAds = Math.max(reachable, ads.length);
  const playbook = buildPlaybook({ brand, ads, taxonomy: taxonomy.entries, report, totalAds }, { taxonomyVersion, minSupport: Math.min(MINE_MIN_SUPPORT, Math.max(2, Math.ceil(ads.length / 10))) });
  const inputHash = createHash("sha256").update(JSON.stringify({ ads: [...ads].sort((a, b) => a.id.localeCompare(b.id)), totalAds, taxonomy: taxonomy.entries })).digest("hex");

  const existing = await supabase.from("CorpusBrandPlaybook").select("id")
    .eq("brand", brand).eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", PLAYBOOK_ENGINE_VERSION).eq("inputHash", inputHash).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return { playbook, written: false, adCount: ads.length };

  const write = await supabase.from("CorpusBrandPlaybook").insert({
    id: playbookId([brand, taxonomyVersion, PLAYBOOK_ENGINE_VERSION, inputHash]),
    brand,
    taxonomyVersion,
    engineVersion: PLAYBOOK_ENGINE_VERSION,
    adCount: ads.length,
    inputHash,
    playbook: JSON.parse(JSON.stringify(playbook)) as Json,
  });
  if (write.error) throw new Error(write.error.message);
  return { playbook, written: true, adCount: ads.length };
}

export async function latestBrandPlaybook(brand: string, taxonomyVersion: string = CORPUS_TAXONOMY_VERSION): Promise<LatestPlaybook | null> {
  const result = await supabase.from("CorpusBrandPlaybook").select("*")
    .eq("brand", brand).eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", PLAYBOOK_ENGINE_VERSION)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data as CorpusBrandPlaybookRow | null;
  return row ? { row, playbook: row.playbook as unknown as BrandPlaybook } : null;
}

/** Brands that have a playbook, newest first — for the results page's switcher. */
export async function listPlaybookBrands(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION): Promise<Array<{ brand: string; adCount: number; createdAt: string }>> {
  const result = await supabase.from("CorpusBrandPlaybook").select("brand, adCount, createdAt")
    .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", PLAYBOOK_ENGINE_VERSION)
    .order("createdAt", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  const seen = new Set<string>();
  const out: Array<{ brand: string; adCount: number; createdAt: string }> = [];
  for (const row of result.data ?? []) {
    if (seen.has(row.brand)) continue;
    seen.add(row.brand);
    out.push(row);
  }
  return out;
}
