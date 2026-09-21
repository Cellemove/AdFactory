// One row per tracked competitor for the brand rail: how far that brand's
// corpus has come, and what it is waiting for. Pure — the page loads the whole
// CorpusAdState once and groups it here, rather than querying per brand.
//
// Competitors with nothing collected still get a row, which is what makes the
// rail a to-do list instead of a filter.

import type { AdTeardownRow, CorpusAdStateRow } from "@/lib/database.types";
import { MEDIA_FAILED } from "./constants";
import { readWinnerPick, type TrackedCompetitor } from "./winners";

/** Share of the bar each stage is worth. Transcribe and beats dominate the real work. */
const WEIGHTS = { collected: 0.1, downloaded: 0.2, transcribed: 0.3, extracted: 0.3, ranked: 0.1 } as const;

export type BrandState = "untouched" | "collecting" | "processing" | "ready" | "attention";

export type BrandSummary = {
  domain: string;
  name: string;
  /** False when the brand has ads in the corpus but is no longer tracked in Spectre. */
  tracked: boolean;
  inCorpus: number;
  /** Ads still able to reach a playbook: inCorpus minus the ones with no usable video. */
  reachable: number;
  downloaded: number;
  transcribed: number;
  extracted: number;
  needsReview: number;
  failed: number;
  ranked: number;
  teardownsDone: number;
  teardownsPending: number;
  /** When this brand's ads were last collected, from the newest winnerPick. */
  lastPickedAt: string | null;
  /** Earliest provider-link expiry among ads still waiting to be downloaded. */
  linksExpireAt: string | null;
  /** 0..1 across collect → download → transcribe → beats → rank. */
  percent: number;
  state: BrandState;
};

function summaryFor(domain: string, name: string, tracked: boolean, rows: CorpusAdStateRow[], teardownByAd: Map<string, AdTeardownRow>, mode: "speech_only" | "full_video"): BrandSummary {
  const videos = rows.filter((row) => row.mediaType === "video" && row.corpusIncluded);
  const count = (predicate: (row: CorpusAdStateRow) => boolean) => videos.filter(predicate).length;
  const inCorpus = videos.length;
  const downloaded = count((row) => mode === "speech_only" ? row.transcriptStatus === "complete" : row.mediaStatus === "downloaded");
  const transcribed = count((row) => row.transcriptStatus === "complete");
  const extracted = count((row) => row.extractStatus === "complete" || row.extractStatus === "reviewed");
  const needsReview = count((row) => row.extractStatus === "needs_human_review");
  const failed = count((row) => row.extractStatus === "failed" || row.transcriptStatus === "failed" || (mode === "full_video" && MEDIA_FAILED.has(row.mediaStatus ?? "")));
  const ranked = count((row) => row.winnerScore != null);
  const reachable = inCorpus - count((row) => mode === "full_video" && MEDIA_FAILED.has(row.mediaStatus ?? ""));

  const picks = videos.map((row) => readWinnerPick(row.winnerPick)?.pickedAt).filter((value): value is string => Boolean(value)).sort();
  const expiries = videos
    .filter((row) => row.mediaStatus !== "downloaded" && row.hasVideoUrl && row.mediaExpiresAt)
    .map((row) => row.mediaExpiresAt!)
    .sort();

  const teardowns = videos.map((row) => teardownByAd.get(row.id)).filter((row): row is AdTeardownRow => Boolean(row));
  const share = (done: number) => (inCorpus > 0 ? done / inCorpus : 0);
  const percent = inCorpus === 0 ? 0 : Math.min(1,
    WEIGHTS.collected
    + WEIGHTS.downloaded * share(downloaded)
    + WEIGHTS.transcribed * share(transcribed)
    + WEIGHTS.extracted * share(extracted)
    + WEIGHTS.ranked * share(ranked));

  let state: BrandState = "untouched";
  if (inCorpus === 0) state = "untouched";
  else if (needsReview > 0 || failed > 0) state = "attention";
  else if (extracted === inCorpus && inCorpus > 0) state = "ready";
  else if (downloaded === 0) state = "collecting";
  else state = "processing";

  return {
    domain, name, tracked,
    inCorpus, reachable, downloaded, transcribed, extracted, needsReview, failed, ranked,
    teardownsDone: teardowns.filter((row) => row.status === "completed").length,
    teardownsPending: teardowns.filter((row) => row.status === "queued" || row.status === "processing").length,
    lastPickedAt: picks.at(-1) ?? null,
    linksExpireAt: expiries[0] ?? null,
    percent,
    state,
  };
}

/**
 * A row per tracked competitor, plus any brand that still has corpus ads but has
 * been dropped from Spectre (so its ads cannot go unnoticed). Furthest along first.
 */
export function brandSummaries(
  rows: CorpusAdStateRow[],
  competitors: TrackedCompetitor[],
  teardowns: AdTeardownRow[],
  mode: "speech_only" | "full_video" = "full_video",
): BrandSummary[] {
  const byBrand = new Map<string, CorpusAdStateRow[]>();
  for (const row of rows) {
    const key = row.brandName.toLowerCase();
    byBrand.set(key, [...(byBrand.get(key) ?? []), row]);
  }
  const teardownByAd = new Map(teardowns.map((row) => [row.competitorAdId, row]));

  const out = competitors.map((competitor) =>
    summaryFor(competitor.domain, competitor.name, true, byBrand.get(competitor.domain.toLowerCase()) ?? [], teardownByAd, mode));

  const tracked = new Set(competitors.map((competitor) => competitor.domain.toLowerCase()));
  for (const [key, brandRows] of byBrand) {
    if (tracked.has(key)) continue;
    const summary = summaryFor(brandRows[0]!.brandName, brandRows[0]!.brandName, false, brandRows, teardownByAd, mode);
    if (summary.inCorpus > 0) out.push(summary);
  }

  return out.sort((a, b) => b.percent - a.percent || b.inCorpus - a.inCorpus || a.domain.localeCompare(b.domain));
}

export function findBrandSummary(summaries: BrandSummary[], brand: string | null | undefined): BrandSummary | null {
  if (!brand) return null;
  const wanted = brand.trim().toLowerCase();
  return summaries.find((summary) => summary.domain.toLowerCase() === wanted) ?? null;
}
