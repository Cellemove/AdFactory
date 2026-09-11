import "server-only";

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

export async function loadCorpusState(): Promise<CorpusState> {
  const result = await supabase.from("CorpusAdState").select("*").order("winnerScore", { ascending: false, nullsFirst: false });
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data ?? []) as CorpusAdStateRow[];
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

export async function loadReviewQueue(): Promise<ReviewQueueItem[]> {
  const runs = await supabase.from("CorpusExtractRun").select("*").eq("status", "needs_human_review").order("createdAt", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  const rows = (runs.data ?? []) as CorpusExtractRunRow[];
  if (!rows.length) return [];
  const ads = await supabase.from("CompetitorAd").select("id, brandName, sourceUrl").in("id", [...new Set(rows.map((run) => run.competitorAdId))]);
  if (ads.error) throw new Error(ads.error.message);
  const byId = new Map((ads.data ?? []).map((ad) => [ad.id, ad]));
  return rows.map((run) => ({ run, ad: byId.get(run.competitorAdId) ?? { id: run.competitorAdId, brandName: "Unknown", sourceUrl: null } }));
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
  const stateResult = await supabase.from("CorpusAdState").select("*").eq("id", adId).maybeSingle();
  if (stateResult.error) throw new Error(stateResult.error.message);
  const state = (stateResult.data as CorpusAdStateRow | null) ?? null;
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
