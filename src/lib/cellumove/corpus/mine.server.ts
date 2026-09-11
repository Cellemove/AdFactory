import "server-only";

import type { AdBeatRow, CompetitorAdRow, CorpusExtractRunRow, CorpusPatternReportRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { CORPUS_ENGINE_VERSION, CORPUS_TAXONOMY_VERSION, MINE_MIN_SUPPORT } from "./constants";
import { reportId } from "./ids";
import { cohortsOf, mineCorpus, type MinedAd } from "./mine";
import { reportInputHash, type CorpusPatternReportJson } from "./report";

export type MinedAdWithRun = MinedAd & { extractRunId: string };

/** Every corpus ad with a complete extraction for the taxonomy, with its beats. */
export async function loadMinedAds(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION): Promise<MinedAdWithRun[]> {
  const runs = await supabase.from("CorpusExtractRun").select("*").eq("taxonomyVersion", taxonomyVersion).eq("status", "complete").order("createdAt", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  const latestByAd = new Map<string, CorpusExtractRunRow>();
  for (const run of (runs.data ?? []) as CorpusExtractRunRow[]) {
    if (!latestByAd.has(run.competitorAdId)) latestByAd.set(run.competitorAdId, run);
  }
  if (!latestByAd.size) return [];
  const runIds = [...latestByAd.values()].map((run) => run.id);
  const adIds = [...latestByAd.keys()];
  const [beats, ads, media] = await Promise.all([
    supabase.from("AdBeat").select("*").in("runId", runIds).order("orderIndex"),
    supabase.from("CompetitorAd").select("*").in("id", adIds).eq("corpusIncluded", true),
    supabase.from("AdMedia").select("competitorAdId, durationSec").in("competitorAdId", adIds),
  ]);
  if (beats.error) throw new Error(beats.error.message);
  if (ads.error) throw new Error(ads.error.message);
  if (media.error) throw new Error(media.error.message);
  const beatsByRun = new Map<string, AdBeatRow[]>();
  for (const beat of (beats.data ?? []) as AdBeatRow[]) beatsByRun.set(beat.runId, [...(beatsByRun.get(beat.runId) ?? []), beat]);
  const durationByAd = new Map((media.data ?? []).map((row) => [row.competitorAdId, row.durationSec]));
  return ((ads.data ?? []) as CompetitorAdRow[]).flatMap((ad) => {
    const run = latestByAd.get(ad.id)!;
    const adBeats = beatsByRun.get(run.id) ?? [];
    if (!adBeats.length) return [];
    return [{
      id: ad.id,
      extractRunId: run.id,
      brand: ad.brandName,
      formatTag: ad.formatTag ?? null,
      angleTag: ad.angleTag ?? null,
      winnerScore: ad.winnerScore ?? null,
      durationSec: durationByAd.get(ad.id) ?? ad.durationSec ?? null,
      beats: adBeats.map((beat) => ({ orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code, startSec: beat.startSec, endSec: beat.endSec })),
    }];
  });
}

export type SaveReportsResult = { written: number; unchanged: number; cohorts: string[] };

/** Mine every cohort and store a snapshot per cohort; unchanged inputs are a no-op. */
export async function mineAndSaveReports(input: { taxonomyVersion?: string; minSupport?: number } = {}): Promise<SaveReportsResult & { all: CorpusPatternReportJson | null }> {
  const taxonomyVersion = input.taxonomyVersion ?? CORPUS_TAXONOMY_VERSION;
  const minSupport = input.minSupport ?? MINE_MIN_SUPPORT;
  const ads = await loadMinedAds(taxonomyVersion);
  const result: SaveReportsResult & { all: CorpusPatternReportJson | null } = { written: 0, unchanged: 0, cohorts: [], all: null };
  for (const cohort of cohortsOf(ads, minSupport)) {
    const inputHash = reportInputHash(cohort.ads as MinedAdWithRun[]);
    const report = mineCorpus(cohort.ads, { taxonomyVersion, engineVersion: CORPUS_ENGINE_VERSION, cohort: cohort.cohort, cohortKey: cohort.cohortKey, minSupport });
    if (cohort.cohort === "all") result.all = report;
    result.cohorts.push(`${cohort.cohort}:${cohort.cohortKey}`);
    const existing = await supabase.from("CorpusPatternReport").select("id")
      .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", CORPUS_ENGINE_VERSION)
      .eq("cohort", cohort.cohort).eq("cohortKey", cohort.cohortKey).eq("inputHash", inputHash).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      result.unchanged += 1;
      continue;
    }
    const write = await supabase.from("CorpusPatternReport").insert({
      id: reportId([taxonomyVersion, CORPUS_ENGINE_VERSION, cohort.cohort, cohort.cohortKey, inputHash]),
      taxonomyVersion,
      engineVersion: CORPUS_ENGINE_VERSION,
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

/** Newest snapshot per cohort for the current taxonomy and engine. */
export async function latestReports(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION): Promise<LatestReport[]> {
  const result = await supabase.from("CorpusPatternReport").select("*")
    .eq("taxonomyVersion", taxonomyVersion).eq("engineVersion", CORPUS_ENGINE_VERSION)
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
