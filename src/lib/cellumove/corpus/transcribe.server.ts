import "server-only";

import { DEFAULT_MODEL } from "@/lib/llm";
import type { AdMediaRow, CompetitorAdRow, CorpusTranscriptRunRow, CorpusTranscriptSegmentRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { CORPUS_TRANSCRIBE_PROMPT_VERSION, USAGE_FEATURES } from "./constants";
import { runKey, segmentId, transcriptRunId } from "./ids";
import { addUsage, generateStructured, parseJsonObject, type UsageSummary } from "./llm-seam.server";
import { readAdMedia } from "./media.server";
import {
  TranscriptResponseSchema,
  buildTranscribePrompt,
  crossCheckTranscript,
  normalizeTranscript,
  parseBrandSearchTranscript,
  type NormalizedTranscript,
} from "./transcribe";

export const TRANSCRIBE_MODEL = process.env.CORPUS_TRANSCRIBE_MODEL?.trim() || DEFAULT_MODEL;

export type TranscribeResult = {
  run: CorpusTranscriptRunRow;
  segments: CorpusTranscriptSegmentRow[];
  reused: boolean;
};

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function loadTranscriptRun(runId: string): Promise<CorpusTranscriptRunRow | null> {
  const result = await supabase.from("CorpusTranscriptRun").select("*").eq("id", runId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CorpusTranscriptRunRow | null) ?? null;
}

export async function loadTranscriptSegments(runId: string): Promise<CorpusTranscriptSegmentRow[]> {
  const result = await supabase.from("CorpusTranscriptSegment").select("*").eq("runId", runId).order("channel").order("orderIndex");
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as CorpusTranscriptSegmentRow[];
}

/** Newest complete transcript run for an ad, if any. */
export async function latestCompleteTranscriptRun(competitorAdId: string): Promise<CorpusTranscriptRunRow | null> {
  const result = await supabase.from("CorpusTranscriptRun").select("*")
    .eq("competitorAdId", competitorAdId).eq("status", "complete")
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CorpusTranscriptRunRow | null) ?? null;
}

async function fetchBrandSearchTranscript(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "text/plain, application/json, text/vtt, */*" } });
    if (!response.ok) return null;
    const text = parseBrandSearchTranscript(await response.text());
    return text || null;
  } catch {
    return null;
  }
}

/**
 * One model call per ad (two on a malformed response), producing timecoded
 * vo + ost segments. Idempotent by run key (ad, media hash, prompt, model).
 */
export async function transcribeAd(ad: CompetitorAdRow, media: AdMediaRow, options: { force?: boolean } = {}): Promise<TranscribeResult> {
  if (media.status !== "downloaded" || !media.sha256) {
    throw new Error(`Media for ${ad.id} is ${media.status}${media.statusReason ? `: ${media.statusReason}` : ""}.`);
  }
  const baseKey = runKey([ad.id, media.sha256, CORPUS_TRANSCRIBE_PROMPT_VERSION, TRANSCRIBE_MODEL]);
  if (!options.force) {
    const existing = await supabase.from("CorpusTranscriptRun").select("*").eq("runKey", baseKey).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const run = existing.data as CorpusTranscriptRunRow | null;
    if (run?.status === "complete") return { run, segments: await loadTranscriptSegments(run.id), reused: true };
  }
  const key = options.force ? runKey([baseKey, Date.now(), Math.random()]) : baseKey;
  const runId = transcriptRunId(key);
  const startedAt = new Date().toISOString();
  const opened = await supabase.from("CorpusTranscriptRun").upsert({
    id: runId,
    runKey: key,
    competitorAdId: ad.id,
    mediaId: media.id,
    mediaSha256: media.sha256,
    model: TRANSCRIBE_MODEL,
    promptVersion: CORPUS_TRANSCRIBE_PROMPT_VERSION,
    status: "running",
    segmentCount: 0,
    errorSummary: null,
    startedAt,
    completedAt: null,
  }, { onConflict: "runKey" });
  if (opened.error) throw new Error(opened.error.message);
  const stale = await supabase.from("CorpusTranscriptSegment").delete().eq("runId", runId);
  if (stale.error) throw new Error(stale.error.message);

  let usage: UsageSummary | null = null;
  try {
    const { bytes, mime } = await readAdMedia(media);
    const [brandSearchTranscript, transcript] = await Promise.all([
      fetchBrandSearchTranscript(ad.transcriptUrl),
      (async (): Promise<NormalizedTranscript> => {
        let previousError: string | undefined;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const prompt = previousError
            ? `${buildTranscribePrompt()}\n\nYour previous response failed validation: ${previousError} Fix exactly that issue and return the full corrected transcript.`
            : buildTranscribePrompt();
          const response = await generateStructured({
            model: TRANSCRIBE_MODEL,
            parts: [{ inlineData: { mimeType: mime, data: bytes.toString("base64") } }, { text: prompt }],
            thinkingBudget: 1024,
            feature: USAGE_FEATURES.transcribe,
            metadata: { competitorAdId: ad.id, runId, promptVersion: CORPUS_TRANSCRIBE_PROMPT_VERSION, mediaSha256: media.sha256, attempt },
          });
          usage = addUsage(usage, response.usage);
          try {
            const parsed = TranscriptResponseSchema.safeParse(parseJsonObject(response.text));
            if (!parsed.success) {
              const issue = parsed.error.issues[0];
              throw new Error(`Response shape is invalid at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "unknown"}.`);
            }
            return normalizeTranscript(parsed.data);
          } catch (error) {
            previousError = error instanceof Error ? error.message : String(error);
          }
        }
        throw new Error(`The transcript was invalid after two attempts: ${previousError ?? "unknown error"}`);
      })(),
    ]);

    const rows: CorpusTranscriptSegmentRow[] = transcript.segments.map((segment) => ({
      id: segmentId(runId, segment.channel, segment.orderIndex),
      runId,
      competitorAdId: ad.id,
      channel: segment.channel,
      orderIndex: segment.orderIndex,
      tStart: segment.tStart,
      tEnd: segment.tEnd,
      text: segment.text,
      confidence: segment.confidence,
      createdAt: startedAt,
    }));
    const inserted = await supabase.from("CorpusTranscriptSegment").insert(rows);
    if (inserted.error) throw new Error(inserted.error.message);

    const crossCheck = crossCheckTranscript(transcript.segments.filter((segment) => segment.channel === "vo"), brandSearchTranscript);
    const completed = await supabase.from("CorpusTranscriptRun").update({
      status: "complete",
      language: transcript.language,
      durationSec: transcript.durationSec,
      segmentCount: rows.length,
      brandSearchTranscript,
      crossCheck: asJson(crossCheck),
      usage: asJson(usage),
      completedAt: new Date().toISOString(),
    }).eq("id", runId).select("*").single();
    if (completed.error) throw new Error(completed.error.message);
    if (media.durationSec == null) {
      await supabase.from("AdMedia").update({ durationSec: transcript.durationSec, updatedAt: new Date().toISOString() }).eq("id", media.id);
    }
    return { run: completed.data as CorpusTranscriptRunRow, segments: rows, reused: false };
  } catch (error) {
    await supabase.from("CorpusTranscriptRun").update({
      status: "failed",
      usage: usage ? asJson(usage) : null,
      errorSummary: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      completedAt: new Date().toISOString(),
    }).eq("id", runId);
    throw error;
  }
}
