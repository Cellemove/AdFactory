import "server-only";

// The first deliverable: one ad, fully decomposed end to end, as a single JSON
// document with every beat carrying its evidence quote, match score and
// timecodes, plus the versions that produced it.

import { CORPUS_ENGINE_VERSION, CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_TRANSCRIBE_PROMPT_VERSION, WINNER_SCORE_VERSION } from "./constants";
import { loadAdDetail } from "./state.server";

export async function dumpAdJson(adId: string): Promise<Record<string, unknown> | null> {
  const detail = await loadAdDetail(adId);
  if (!detail) return null;
  const { ad, media, transcriptRun, segments, extractRun, beats } = detail;
  return {
    ad: {
      id: ad.id,
      brandName: ad.brandName,
      externalId: ad.externalId,
      sourceUrl: ad.sourceUrl,
      status: ad.status,
      startedAt: ad.startedAt,
      endedAt: ad.endedAt,
      metrics: ad.metrics,
      winnerScore: ad.winnerScore ?? null,
      winnerScoreInputs: ad.winnerScoreInputs ?? null,
      formatTag: ad.formatTag ?? null,
      angleTag: ad.angleTag ?? null,
      stage: detail.state?.stage ?? null,
    },
    media: media ? { status: media.status, statusReason: media.statusReason, sha256: media.sha256, bytes: media.bytes, mime: media.mime, storagePath: media.storagePath ?? null, localPath: media.localPath, durationSec: media.durationSec, sourceKind: media.sourceKind } : null,
    transcript: transcriptRun ? {
      runId: transcriptRun.id,
      status: transcriptRun.status,
      model: transcriptRun.model,
      promptVersion: transcriptRun.promptVersion,
      language: transcriptRun.language,
      durationSec: transcriptRun.durationSec,
      crossCheck: transcriptRun.crossCheck,
      usage: transcriptRun.usage,
      segments: segments.map((segment) => ({ id: segment.id, channel: segment.channel, orderIndex: segment.orderIndex, tStart: segment.tStart, tEnd: segment.tEnd, text: segment.text, confidence: segment.confidence })),
    } : null,
    extract: extractRun ? {
      runId: extractRun.id,
      status: extractRun.status,
      model: extractRun.model,
      taxonomyVersion: extractRun.taxonomyVersion,
      extractorPromptVersion: extractRun.extractorPromptVersion,
      withVideo: extractRun.withVideo,
      attempts: extractRun.attempts,
      errorCode: extractRun.errorCode,
      errorSummary: extractRun.errorSummary,
      gateReport: extractRun.gateReport,
      usage: extractRun.usage,
      rawResponse: extractRun.status === "needs_human_review" ? extractRun.rawResponse : undefined,
    } : null,
    beats: beats.map((beat) => ({
      orderIndex: beat.orderIndex,
      layer: beat.layer,
      code: beat.code,
      startSec: beat.startSec,
      endSec: beat.endSec,
      channel: beat.channel,
      evidenceQuote: beat.evidenceQuote,
      matchScore: beat.matchScore,
      matchedSegmentId: beat.matchedSegmentId,
      otherExplanation: beat.otherExplanation,
    })),
    versions: {
      engine: CORPUS_ENGINE_VERSION,
      transcribePrompt: CORPUS_TRANSCRIBE_PROMPT_VERSION,
      extractPrompt: CORPUS_EXTRACT_PROMPT_VERSION,
      taxonomy: extractRun?.taxonomyVersion ?? null,
      winnerScore: WINNER_SCORE_VERSION,
    },
  };
}
