import "server-only";
import { defaultResearchMode } from "@/lib/brandsearch-research.server";
import { modeVersion, type ResearchMode } from "@/lib/brandsearch-research";

import type { AdBeatRow, CompetitorAdRow, CorpusExtractRunRow, CorpusPatternReportRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { CORPUS_ENGINE_VERSION, CORPUS_TAXONOMY_VERSION, MINE_MIN_SUPPORT } from "./constants";
import { reportId } from "./ids";
import { cohortsOf, mineCorpus, type MinedAd } from "./mine";
import { reportInputHash, type CorpusPatternReportJson } from "./report";
import { loadAllRows } from "./pagination";

export type MinedAdWithRun = MinedAd & { extractRunId: string };

/** Every corpus ad with a complete extraction for the taxonomy, with its beats. */
export async function loadMinedAds(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION, mode: ResearchMode = defaultResearchMode()): Promise<MinedAdWithRun[]> {
  const runs = await supabase.from("CorpusExtractRun").select("*").eq("taxonomyVersion", taxonomyVersion).eq("researchMode", mode).eq("status", "complete").order("createdAt", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  const latestByAd = new Map<string, CorpusExtractRunRow>();
  for (const run of (runs.data ?? []) as CorpusExtractRunRow[]) {
    if (!latestByAd.has(run.competitorAdId)) latestByAd.set(run.competitorAdId, run);
  }
  if (!latestByAd.size) return [];
  const runIds = [...latestByAd.values()].map((run) => run.id);
  const adIds = [...latestByAd.keys()];
  const [beats, ads, media, transcripts] = await Promise.all([
    loadAllRows((from, to) => supabase.from("AdBeat").select("*").in("runId", runIds).order("id").range(from, to)),
    supabase.from("CompetitorAd").select("*").in("id", adIds).eq("corpusIncluded", true),
    supabase.from("AdMedia").select("competitorAdId, durationSec").in("competitorAdId", adIds),
    supabase.from("CorpusTranscriptRun").select("id, durationSec").in("id", [...latestByAd.values()].map((run) => run.transcriptRunId)),
  ]);
  if (ads.error) throw new Error(ads.error.message);
  if (media.error) throw new Error(media.error.message);
  if (transcripts.error) throw new Error(transcripts.error.message);
  const transcriptDuration = new Map((transcripts.data ?? []).map((row) => [row.id, row.durationSec]));
  const beatsByRun = new Map<string, AdBeatRow[]>();
  for (const beat of beats as AdBeatRow[]) beatsByRun.set(beat.runId, [...(beatsByRun.get(beat.runId) ?? []), beat]);
  const durationByAd = new Map((media.data ?? []).map((row) => [row.competitorAdId, row.durationSec]));
  return ((ads.data ?? []) as CompetitorAdRow[]).flatMap((ad) => {
    const run = latestByAd.get(ad.id)!;
    const adBeats = beatsByRun.get(run.id) ?? [];
    if (!adBeats.length) return [];
    return [{
      id: ad.id,
      extractRunId: run.id,
      brand: ad.brandName,
      formatTag: mode === "speech_only" ? null : ad.formatTag ?? null,
      angleTag: mode === "speech_only" ? run.conceptTag ?? null : ad.angleTag ?? null,
      winnerScore: ad.winnerScore ?? null,
      durationSec: transcriptDuration.get(run.transcriptRunId) ?? durationByAd.get(ad.id) ?? ad.durationSec ?? null,
      beats: adBeats.map((beat) => ({ orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code, startSec: beat.startSec, endSec: beat.endSec })),
    }];
  });
}

export type SaveReportsResult = { written: number; unchanged: number; cohorts: string[] };

/**
 * Mine every cohort and store a snapshot per cohort; unchanged inputs are a no-op.
 *
 * `brand` narrows what is WRITTEN, never what is loaded. Mining a brand off a
 * brand-filtered load would file one brand's ads under the global "all" key and
 * rewrite the shared format/angle cohorts with brand-local numbers — so the
 * whole corpus is always mined, and only the "all" and "brand:<domain>"
 * snapshots are saved when a brand is given.
 */
export async function mineAndSaveReports(input: { taxonomyVersion?: string; minSupport?: number; brand?: string | null; mode?: ResearchMode } = {}): Promise<SaveReportsResult & { all: CorpusPatternReportJson | null; brand: CorpusPatternReportJson | null }> {
  const mode = input.mode ?? defaultResearchMode();
  const engineVersion = modeVersion(CORPUS_ENGINE_VERSION, mode);
  const taxonomyVersion = input.taxonomyVersion ?? CORPUS_TAXONOMY_VERSION;
  const minSupport = input.minSupport ?? MINE_MIN_SUPPORT;
  const wantedBrand = input.brand?.trim().toLowerCase() || null;
  const ads = await loadMinedAds(taxonomyVersion, mode);
  const result: SaveReportsResult & { all: CorpusPatternReportJson | null; brand: CorpusPatternReportJson | null } = { written: 0, unchanged: 0, cohorts: [], all: null, brand: null };
  for (const cohort of cohortsOf(ads, minSupport)) {
    const isWantedBrand = cohort.cohort === "brand" && cohort.cohortKey.toLowerCase() === wantedBrand;
    if (wantedBrand && cohort.cohort !== "all" && !isWantedBrand) continue;
    const inputHash = reportInputHash(cohort.ads as MinedAdWithRun[]);
    const report = mineCorpus(cohort.ads, { taxonomyVersion, engineVersion, cohort: cohort.cohort, cohortKey: cohort.cohortKey, minSupport });
    if (mode === "speech_only") report.caveats.push("Speech-only patterns: on-screen copy and visual evidence were not assessed.");
    if (cohort.cohort === "all") result.all = report;
    if (isWantedBrand) result.brand = report;
    result.cohorts.push(`${cohort.cohort}:${cohort.cohortKey}`);
    const existing = await supabase.from("CorpusPatternReport").select("id")
      .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", engineVersion)
      .eq("cohort", cohort.cohort).eq("cohortKey", cohort.cohortKey).eq("inputHash", inputHash).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      result.unchanged += 1;
      continue;
    }
    const write = await supabase.from("CorpusPatternReport").insert({
      id: reportId([taxonomyVersion, engineVersion, cohort.cohort, cohort.cohortKey, inputHash]),
      taxonomyVersion,
      engineVersion,
      cohort: cohort.cohort,
      cohortKey: cohort.cohortKey,
      adCount: cohort.ads.length,
      inputHash,
      report: JSON.parse(JSON.stringify(report)) as Json,
    });
    if (write.error) throw new Error(write.error.message);
    result.written += 1;
  }
  return result;
}

export type LatestReport = { row: CorpusPatternReportRow; report: CorpusPatternReportJson };

/** Newest snapshot for one brand, or null when that brand has never been mined. */
export async function latestBrandReport(brand: string, taxonomyVersion: string = CORPUS_TAXONOMY_VERSION, mode: ResearchMode = defaultResearchMode()): Promise<LatestReport | null> {
  const engineVersion = modeVersion(CORPUS_ENGINE_VERSION, mode);
  const result = await supabase.from("CorpusPatternReport").select("*")
    .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", engineVersion)
    .eq("cohort", "brand").eq("cohortKey", brand)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data as CorpusPatternReportRow | null;
  return row ? { row, report: row.report as unknown as CorpusPatternReportJson } : null;
}

/** Newest snapshot per cohort for the current taxonomy and engine. */
export async function latestReports(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION, mode: ResearchMode = defaultResearchMode()): Promise<LatestReport[]> {
  const engineVersion = modeVersion(CORPUS_ENGINE_VERSION, mode);
  const result = await supabase.from("CorpusPatternReport").select("*")
    .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", engineVersion)
    .order("createdAt", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  const seen = new Set<string>();
  const out: LatestReport[] = [];
  for (const row of (result.data ?? []) as CorpusPatternReportRow[]) {
    const key = `${row.cohort}:${row.cohortKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ row, report: row.report as unknown as CorpusPatternReportJson });
  }
  return out.sort((a, b) => (a.row.cohort === "all" ? -1 : b.row.cohort === "all" ? 1 : b.row.adCount - a.row.adCount));
}
