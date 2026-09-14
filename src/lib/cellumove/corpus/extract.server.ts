import "server-only";

import { DEFAULT_MODEL } from "@/lib/llm";
import type { AdBeatRow, AdMediaRow, CompetitorAdRow, CorpusExtractRunRow, CorpusTranscriptRunRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { CORPUS_ENGINE_VERSION, CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_TAXONOMY_VERSION, USAGE_FEATURES, type TranscriptChannel } from "./constants";
import { ExtractValidationError, buildExtractPrompt, validateExtractedBeats, type ValidatedExtraction } from "./extract";
import { beatId, extractRunId, runKey } from "./ids";
import { addUsage, generateStructured, parseJsonObject, type StructuredPart, type UsageSummary } from "./llm-seam.server";
import { readAdMedia } from "./media.server";
import { loadTaxonomy } from "./taxonomy.server";
import { renderTranscript } from "./transcribe";
import { loadTranscriptSegments } from "./transcribe.server";

export const EXTRACT_MODEL = process.env.CORPUS_EXTRACT_MODEL?.trim() || DEFAULT_MODEL;

export type ExtractOptions = {
  force?: boolean;
  /** Re-run an ad that was quarantined for human review. */
  retryReview?: boolean;
  /** Attach the video bytes as well as the transcript (the spec's contact sheet). */
  withVideo?: boolean;
  media?: AdMediaRow | null;
  taxonomyVersion?: string;
};

export type ExtractResult = {
  run: CorpusExtractRunRow;
  beats: AdBeatRow[];
  reused: boolean;
};

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function loadExtractRun(runId: string): Promise<CorpusExtractRunRow | null> {
  const result = await supabase.from("CorpusExtractRun").select("*").eq("id", runId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CorpusExtractRunRow | null) ?? null;
}

export async function loadAdBeats(runId: string): Promise<AdBeatRow[]> {
  const result = await supabase.from("AdBeat").select("*").eq("runId", runId).order("orderIndex");
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as AdBeatRow[];
}

/**
 * One model call per ad, a second only when validation fails, then quarantine.
 * The evidence gate decides; the model never gets a third chance.
 */
export async function extractAdBeats(
  ad: CompetitorAdRow,
  transcriptRun: CorpusTranscriptRunRow,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (transcriptRun.status !== "complete") throw new Error(`Transcript run ${transcriptRun.id} is ${transcriptRun.status}, not complete.`);
  const taxonomyVersion = options.taxonomyVersion ?? CORPUS_TAXONOMY_VERSION;
  const withVideo = Boolean(options.withVideo);
  const baseKey = runKey([ad.id, transcriptRun.id, taxonomyVersion, CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_ENGINE_VERSION, EXTRACT_MODEL, withVideo ? "with-video" : "text-only"]);

  if (!options.force) {
    const existing = await supabase.from("CorpusExtractRun").select("*").eq("runKey", baseKey).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const run = existing.data as CorpusExtractRunRow | null;
    if (run && (run.status === "complete" || run.status === "reviewed")) return { run, beats: await loadAdBeats(run.id), reused: true };
    if (run?.status === "needs_human_review" && !options.retryReview) return { run, beats: [], reused: true };
  }

  const taxonomy = await loadTaxonomy(taxonomyVersion);
  const segmentRows = await loadTranscriptSegments(transcriptRun.id);
  if (!segmentRows.length) throw new Error(`Transcript run ${transcriptRun.id} has no segments.`);
  const segments = segmentRows.map((row) => ({
    id: row.id,
    channel: row.channel as TranscriptChannel,
    orderIndex: row.orderIndex,
    tStart: row.tStart,
    tEnd: row.tEnd,
    text: row.text,
    confidence: row.confidence,
  }));
  const transcriptEnd = transcriptRun.durationSec ?? segments.reduce((max, segment) => Math.max(max, segment.tEnd), 0);
  const transcriptText = renderTranscript(segments);

  const key = options.force ? runKey([baseKey, Date.now(), Math.random()]) : baseKey;
  const runId = extractRunId(key);
  const startedAt = new Date().toISOString();
  const opened = await supabase.from("CorpusExtractRun").upsert({
    id: runId,
    runKey: key,
    competitorAdId: ad.id,
    transcriptRunId: transcriptRun.id,
    taxonomyVersion,
    extractorPromptVersion: CORPUS_EXTRACT_PROMPT_VERSION,
    engineVersion: CORPUS_ENGINE_VERSION,
    model: EXTRACT_MODEL,
    withVideo,
    status: "running",
    attempts: 0,
    gateReport: null,
    rawResponse: null,
    errorCode: null,
    errorSummary: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    startedAt,
    completedAt: null,
  }, { onConflict: "runKey" });
  if (opened.error) throw new Error(opened.error.message);
  const stale = await supabase.from("AdBeat").delete().eq("runId", runId);
  if (stale.error) throw new Error(stale.error.message);

  let videoPart: StructuredPart | null = null;
  if (withVideo) {
    if (!options.media) throw new Error("withVideo requires the ad's AdMedia row.");
    const { bytes, mime } = await readAdMedia(options.media);
    videoPart = { inlineData: { mimeType: mime, data: bytes.toString("base64") } };
  }

  let usage: UsageSummary | null = null;
  let attempts = 0;
  let previousError: string | undefined;
  let lastValidation: ExtractValidationError | null = null;
  let lastRaw: unknown = null;
  let validated: ValidatedExtraction | null = null;

  try {
    for (attempts = 1; attempts <= 2 && !validated; attempts += 1) {
      const prompt = buildExtractPrompt({
        taxonomyVersion,
        taxonomy: taxonomy.entries,
        transcriptText,
        durationSec: transcriptEnd,
        language: transcriptRun.language,
        previousError,
        withVideo,
      });
      const response = await generateStructured({
        model: EXTRACT_MODEL,
        parts: videoPart ? [videoPart, { text: prompt }] : [{ text: prompt }],
        thinkingBudget: 2048,
        feature: USAGE_FEATURES.extract,
        metadata: { competitorAdId: ad.id, runId, promptVersion: CORPUS_EXTRACT_PROMPT_VERSION, taxonomyVersion, attempt: attempts, withVideo },
      });
      usage = addUsage(usage, response.usage);
      try {
        lastRaw = parseJsonObject(response.text);
        validated = validateExtractedBeats({ raw: lastRaw, allowedCodes: taxonomy.allowedCodes, segments, transcriptEnd });
      } catch (error) {
        if (error instanceof ExtractValidationError) {
          lastValidation = error;
          previousError = error.message;
        } else {
          lastValidation = new ExtractValidationError(error instanceof Error ? error.message : String(error), "SCHEMA");
          previousError = lastValidation.message;
        }
      }
    }
    attempts = Math.min(attempts - 1, 2);

    if (!validated) {
      const quarantined = await supabase.from("CorpusExtractRun").update({
        status: "needs_human_review",
        attempts,
        gateReport: lastValidation?.gate ? asJson(lastValidation.gate) : null,
        rawResponse: lastRaw == null ? null : asJson(lastRaw),
        usage: asJson(usage),
        errorCode: lastValidation?.code ?? "SCHEMA",
        errorSummary: (lastValidation?.message ?? "Unknown validation failure").slice(0, 2000),
        completedAt: new Date().toISOString(),
      }).eq("id", runId).select("*").single();
      if (quarantined.error) throw new Error(quarantined.error.message);
      return { run: quarantined.data as CorpusExtractRunRow, beats: [], reused: false };
    }

    const beatRows: AdBeatRow[] = validated.beats.map((beat) => ({
      id: beatId(runId, beat.orderIndex),
      runId,
      competitorAdId: ad.id,
      taxonomyVersion,
      orderIndex: beat.orderIndex,
      layer: beat.layer,
      code: beat.code,
      startSec: beat.startSec,
      endSec: beat.endSec,
      evidenceQuote: beat.evidenceQuote,
      otherExplanation: beat.otherExplanation,
      channel: beat.channel,
      matchScore: beat.matchScore,
      matchedSegmentId: beat.matchedSegmentId,
      extractorPromptVersion: CORPUS_EXTRACT_PROMPT_VERSION,
      model: EXTRACT_MODEL,
      createdAt: startedAt,
    }));
    const inserted = await supabase.from("AdBeat").insert(beatRows);
    if (inserted.error) throw new Error(inserted.error.message);

    const completed = await supabase.from("CorpusExtractRun").update({
      status: "complete",
      attempts,
      gateReport: asJson(validated.gate),
      rawResponse: asJson(lastRaw),
      usage: asJson(usage),
      errorCode: null,
      errorSummary: null,
      completedAt: new Date().toISOString(),
    }).eq("id", runId).select("*").single();
    if (completed.error) throw new Error(completed.error.message);

    if (validated.format && (!ad.formatTag || ad.tagSource === "llm")) {
      await supabase.from("CompetitorAd").update({ formatTag: validated.format, tagSource: "llm", updatedAt: new Date().toISOString() }).eq("id", ad.id);
    }
    return { run: completed.data as CorpusExtractRunRow, beats: beatRows, reused: false };
  } catch (error) {
    await supabase.from("CorpusExtractRun").update({
      status: "failed",
      attempts,
      usage: usage ? asJson(usage) : null,
      errorCode: "MODEL",
      errorSummary: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      completedAt: new Date().toISOString(),
    }).eq("id", runId);
    throw error;
  }
}
