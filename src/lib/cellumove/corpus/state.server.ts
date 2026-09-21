import "server-only";
import { defaultResearchMode } from "@/lib/brandsearch-research.server";
import type { ResearchMode } from "@/lib/brandsearch-research";
import { loadAllRows } from "./pagination";

import type { AdBeatRow, AdMediaRow, AdTeardownRow, CompetitorAdRow, CorpusAdStateRow, CorpusExtractRunRow, CorpusTranscriptRunRow, CorpusTranscriptSegmentRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { loadExtractRun, loadAdBeats } from "./extract.server";
import { loadAdMedia } from "./media.server";
import { loadAdTeardown } from "./teardown.server";
import { loadTranscriptRun, loadTranscriptSegments } from "./transcribe.server";

export const STAGES = ["ingested", "media", "transcribed", "extracted", "needs_review", "failed", "skipped"] as const;
export type Stage = (typeof STAGES)[number];

export type CorpusState = {
  rows: CorpusAdStateRow[];
  counts: Record<Stage, number>;
  /** Video ads whose provider link expires within 24h and have no downloaded copy. */
  expiringSoon: number;
};

export async function loadCorpusState(mode: ResearchMode = defaultResearchMode(), adId?: string): Promise<CorpusState> {
  // One ad's detail page must not scan every run and beat in the corpus.
  const scoped = <Q extends { eq(column: string, value: string): Q }>(query: Q, column = "competitorAdId"): Q => adId ? query.eq(column, adId) : query;
  const result = await scoped(supabase.from("CorpusAdState").select("*"), "id").order("winnerScore", { ascending: false, nullsFirst: false });
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data ?? []) as CorpusAdStateRow[];
  // Select a run within the requested coverage mode; latest overall mixes evidence.
  const [transcripts, extracts] = await Promise.all([
    loadAllRows((from, to) => scoped(supabase.from("CorpusTranscriptRun").select("*")).eq("source", mode === "speech_only" ? "brandsearch" : "video_model").order("createdAt", { ascending: false }).order("id").range(from, to)),
    loadAllRows((from, to) => scoped(supabase.from("CorpusExtractRun").select("*")).eq("researchMode", mode).order("createdAt", { ascending: false }).order("id").range(from, to)),
  ]);
  const allBeats = await loadAllRows((from, to) => scoped(supabase.from("AdBeat").select("runId")).order("id").range(from, to));
  const beatCounts = new Map<string, number>();
  for (const beat of allBeats as Array<{ runId: string }>) beatCounts.set(beat.runId, (beatCounts.get(beat.runId) ?? 0) + 1);
  for (const row of rows) {
    const runs = (transcripts as CorpusTranscriptRunRow[]).filter((t) => t.competitorAdId === row.id);
    const t = runs.find((t) => t.status === "complete") ?? runs[0];
    const es = (extracts as CorpusExtractRunRow[]).filter((e) => e.competitorAdId === row.id && e.transcriptRunId === t?.id);
    const e = es.find((e) => ["complete", "reviewed"].includes(e.status)) ?? es[0];
    row.transcriptRunId = t?.id ?? null; row.transcriptStatus = t?.status ?? null; row.segmentCount = t?.segmentCount ?? null;
    row.beatCount = e ? beatCounts.get(e.id) ?? 0 : 0;
    row.extractRunId = e?.id ?? null; row.extractStatus = e?.status ?? null;
    row.extractTaxonomyVersion = e?.taxonomyVersion ?? null; row.extractError = e?.errorSummary ?? null;
    row.stage = !row.corpusIncluded || row.mediaType !== "video" ? "skipped"
      : e && ["complete", "reviewed"].includes(e.status) ? "extracted" : e?.status === "needs_human_review" ? "needs_review"
      : t?.status === "complete" ? "transcribed" : t?.status === "failed" || e?.status === "failed" || (mode === "full_video" && ["failed", "oversize", "unavailable", "expired", "not_video"].includes(row.mediaStatus ?? "")) ? "failed"
      : row.mediaStatus === "downloaded" ? "media" : "ingested";
  }

  const counts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<Stage, number>;
  for (const row of rows) counts[row.stage] += 1;
  const soon = Date.now() + 24 * 60 * 60 * 1000;
  const expiringSoon = rows.filter((row) => row.mediaType === "video" && row.corpusIncluded && row.mediaStatus !== "downloaded" && row.hasVideoUrl && row.mediaExpiresAt && Date.parse(row.mediaExpiresAt) <= soon).length;
  return { rows, counts, expiringSoon };
}

/** Ads at a given stage — the selector every runner uses. */
export async function adsAtStage(stage: Stage | Stage[], filters: { ids?: string[]; brand?: string; limit?: number } = {}): Promise<CompetitorAdRow[]> {
  const stages = Array.isArray(stage) ? stage : [stage];
  let query = supabase.from("CorpusAdState").select("id").in("stage", stages).order("winnerScore", { ascending: false, nullsFirst: false });
  if (filters.ids?.length) query = query.in("id", filters.ids);
  if (filters.brand) query = query.eq("brandName", filters.brand);
  if (filters.limit) query = query.limit(filters.limit);
  const state = await query;
  if (state.error) throw new Error(state.error.message);
  const ids = (state.data ?? []).map((row) => row.id);
  if (!ids.length) return [];
  const ads = await supabase.from("CompetitorAd").select("*").in("id", ids);
  if (ads.error) throw new Error(ads.error.message);
  const order = new Map(ids.map((id, index) => [id, index]));
  return ((ads.data ?? []) as CompetitorAdRow[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function loadCompetitorAds(filters: { ids?: string[]; brand?: string; limit?: number; videoOnly?: boolean } = {}): Promise<CompetitorAdRow[]> {
  let query = supabase.from("CompetitorAd").select("*").order("fetchedAt", { ascending: false });
  if (filters.ids?.length) query = query.in("id", filters.ids);
  if (filters.brand) query = query.eq("brandName", filters.brand);
  if (filters.videoOnly) query = query.eq("mediaType", "video");
  if (filters.limit) query = query.limit(filters.limit);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as CompetitorAdRow[];
}

export type ReviewQueueItem = { run: CorpusExtractRunRow; ad: Pick<CompetitorAdRow, "id" | "brandName" | "sourceUrl"> };

export async function loadReviewQueue(filters: { brand?: string | null } = {}): Promise<ReviewQueueItem[]> {
  const runs = await supabase.from("CorpusExtractRun").select("*").eq("status", "needs_human_review").order("createdAt", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  const rows = (runs.data ?? []) as CorpusExtractRunRow[];
  if (!rows.length) return [];
  const ads = await supabase.from("CompetitorAd").select("id, brandName, sourceUrl").in("id", [...new Set(rows.map((run) => run.competitorAdId))]);
  if (ads.error) throw new Error(ads.error.message);
  const byId = new Map((ads.data ?? []).map((ad) => [ad.id, ad]));
  const queue = rows.map((run) => ({ run, ad: byId.get(run.competitorAdId) ?? { id: run.competitorAdId, brandName: "Unknown", sourceUrl: null } }));
  const brand = filters.brand?.trim().toLowerCase();
  return brand ? queue.filter((item) => item.ad.brandName.toLowerCase() === brand) : queue;
}

export type AdDetail = {
  ad: CompetitorAdRow;
  media: AdMediaRow | null;
  transcriptRun: CorpusTranscriptRunRow | null;
  segments: CorpusTranscriptSegmentRow[];
  extractRun: CorpusExtractRunRow | null;
  beats: AdBeatRow[];
  state: CorpusAdStateRow | null;
  teardown: AdTeardownRow | null;
};

export async function loadAdDetail(adId: string): Promise<AdDetail | null> {
  const adResult = await supabase.from("CompetitorAd").select("*").eq("id", adId).maybeSingle();
  if (adResult.error) throw new Error(adResult.error.message);
  const ad = adResult.data as CompetitorAdRow | null;
  if (!ad) return null;
  // Show the default mode's evidence, else whatever the other mode already holds:
  // flipping the feature flag must not hide an ad's existing full-video breakdown.
  const mode = defaultResearchMode();
  let state = (await loadCorpusState(mode, adId)).rows[0] ?? null;
  if (!state?.transcriptRunId) state = (await loadCorpusState(mode === "speech_only" ? "full_video" : "speech_only", adId)).rows.find((row) => row.transcriptRunId) ?? state;
  const media = await loadAdMedia(adId);
  const transcriptRun = state?.transcriptRunId ? await loadTranscriptRun(state.transcriptRunId) : null;
  const segments = transcriptRun ? await loadTranscriptSegments(transcriptRun.id) : [];
  const extractRun = state?.extractRunId ? await loadExtractRun(state.extractRunId) : null;
  const beats = extractRun ? await loadAdBeats(extractRun.id) : [];
  const teardown = await loadAdTeardown(adId);
  return { ad, media, transcriptRun, segments, extractRun, beats, state, teardown };
}

export async function markExtractReviewed(runId: string, userId: string, note: string | null): Promise<void> {
  const write = await supabase.from("CorpusExtractRun").update({
    status: "reviewed",
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNote: note,
  }).eq("id", runId).eq("status", "needs_human_review");
  if (write.error) throw new Error(write.error.message);
}
