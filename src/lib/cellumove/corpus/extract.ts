// EXTRACT — pure half. The prompt that turns a two-channel transcript into
// ordered beats from a CLOSED taxonomy, and the validation that runs after the
// model call: schema, contiguity, enum membership, then the evidence gate.
// Every validation failure produces the exact sentence that is fed back to the
// model on its single retry.

import { z } from "zod";
import { SCRIPT_FORMATS } from "@/lib/cellumove/script-studio";
import { ScorerLayerSchema, type ScorerLayer } from "@/lib/cellumove/script-scorer";
import { TRANSCRIPT_CHANNELS, type TranscriptChannel } from "./constants";
import { gateBeats, type GateReport, type GateSegment } from "./evidence-gate";
import type { TranscriptSegment } from "./transcribe";

export const CORPUS_FORMAT_TAGS = [...SCRIPT_FORMATS, "Other"] as const;

export const ExtractedBeatSchema = z.object({
  order_index: z.number().int().nonnegative(),
  layer: ScorerLayerSchema,
  code: z.string().trim().min(1),
  t_start: z.number().finite(),
  t_end: z.number().finite(),
  evidence_quote: z.string().trim().min(1),
  channel: z.enum(TRANSCRIPT_CHANNELS),
  other_explanation: z.string().trim().min(1).nullish(),
});

export const ExtractResponseSchema = z.object({
  format: z.string().trim().min(1).nullish(),
  beats: z.array(ExtractedBeatSchema).min(1),
});

export type ExtractedBeat = z.infer<typeof ExtractedBeatSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

export type TaxonomyEntry = { code: string; layer: string; label: string; description: string };

export type ValidatedBeat = {
  orderIndex: number;
  layer: ScorerLayer;
  code: string;
  startSec: number;
  endSec: number;
  evidenceQuote: string;
  channel: TranscriptChannel;
  otherExplanation: string | null;
  matchScore: number;
  matchedSegmentId: string | null;
  lowConfidenceEvidence: boolean;
};

export type ValidatedExtraction = {
  beats: ValidatedBeat[];
  format: (typeof CORPUS_FORMAT_TAGS)[number] | null;
  gate: GateReport;
};

export class ExtractValidationError extends Error {
  constructor(message: string, readonly code: "SCHEMA" | "EVIDENCE_GATE" | "TIMECODE", readonly gate?: GateReport) {
    super(message);
    this.name = "ExtractValidationError";
  }
}

/** Every OTHER-style code in the taxonomy (global OTHER, per-layer *_OTHER). */
export function isOtherCode(code: string, layer: string): boolean {
  return layer === "OTHER" || code === "OTHER" || /_OTHER$/.test(code);
}

export function buildExtractPrompt(input: {
  taxonomyVersion: string;
  taxonomy: TaxonomyEntry[];
  transcriptText: string;
  durationSec: number;
  language: string | null;
  previousError?: string;
  withVideo?: boolean;
}): string {
  const formats = CORPUS_FORMAT_TAGS.join(" | ");
  return [
    "Decompose this video ad transcript into an ordered list of BEATS using ONLY the closed taxonomy below. This is mechanical labelling, not copywriting.",
    'Return exactly one JSON object {"format": string, "beats": [...]} and no prose.',
    input.withVideo ? "The video itself is attached as well; use it to see demos, before/after shots and visual proof, but every evidence_quote must still come from the transcript." : "",
    "",
    "Rules:",
    "- A beat is a contiguous stretch of the ad doing ONE job. Cover the whole ad in order; beats must not overlap; do not skip content that carries meaning.",
    "- layer must be one of H, Q, P, B, M, PR, O, OTHER. code must be one of the taxonomy codes below and must belong to that layer. Never invent codes.",
    "- Use an OTHER code only when nothing fits, and then other_explanation is mandatory (one sentence: what the beat does).",
    "- evidence_quote must be an EXACT, contiguous substring copied from ONE transcript segment (or two adjacent segments of the same channel). Same characters, same casing, same language. Do not paraphrase, translate, or fix typos. Keep it to the decisive words (3-25 words).",
    '- channel is the channel the evidence_quote came from: "vo" or "ost".',
    "- t_start / t_end are seconds and must lie within the span of the segment(s) you quoted.",
    "- order_index starts at 0 and increases by 1 with no gaps, in time order.",
    "- Layers may appear in any order and may repeat; do not force the H→Q→P→B→M→PR→O order.",
    `- format is the ad's production format, exactly one of: ${formats}.`,
    "",
    'Required beat shape: {"order_index": int, "layer": string, "code": string, "t_start": number, "t_end": number, "evidence_quote": string, "channel": "vo" | "ost", "other_explanation": string | null}',
    input.previousError ? `\nYour previous response failed validation: ${input.previousError}\nFix exactly that issue and return the full corrected list.` : "",
    "",
    `TAXONOMY (version ${input.taxonomyVersion}):`,
    JSON.stringify(input.taxonomy.map((entry) => ({ code: entry.code, layer: entry.layer, label: entry.label, description: entry.description }))),
    "",
    `TRANSCRIPT (${input.durationSec}s${input.language ? `, language ${input.language}` : ""}); one segment per line as [channel t_start-t_end] text:`,
    input.transcriptText,
  ].filter((line) => line !== "").join("\n");
}

function normalizeFormat(value: string | null | undefined): ValidatedExtraction["format"] {
  if (!value) return null;
  const wanted = value.trim().toLowerCase();
  return CORPUS_FORMAT_TAGS.find((format) => format.toLowerCase() === wanted) ?? "Other";
}

/**
 * Validate a parsed model response against the taxonomy and the transcript.
 * Throws ExtractValidationError with the sentence to feed back on retry.
 */
export function validateExtractedBeats(input: {
  raw: unknown;
  allowedCodes: ReadonlyMap<string, ScorerLayer>;
  segments: Array<TranscriptSegment & { id: string }>;
  transcriptEnd: number;
  threshold?: number;
}): ValidatedExtraction {
  const parsed = ExtractResponseSchema.safeParse(input.raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ExtractValidationError(`Response shape is invalid at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "unknown"}.`, "SCHEMA");
  }
  const beats = [...parsed.data.beats].sort((a, b) => a.order_index - b.order_index);
  const indexes = beats.map((beat) => beat.order_index);
  if (new Set(indexes).size !== indexes.length || indexes.some((value, index) => value !== index)) {
    throw new ExtractValidationError(`order_index values must be 0..${beats.length - 1} with no gaps or duplicates (got ${indexes.join(",")}).`, "SCHEMA");
  }
  for (const beat of beats) {
    const expectedLayer = input.allowedCodes.get(beat.code);
    if (!expectedLayer) {
      throw new ExtractValidationError(`Beat ${beat.order_index} uses unknown taxonomy code "${beat.code}"; choose a code from the TAXONOMY list.`, "SCHEMA");
    }
    if (expectedLayer !== beat.layer) {
      throw new ExtractValidationError(`Beat ${beat.order_index} pairs code ${beat.code} with layer ${beat.layer}, but ${beat.code} belongs to layer ${expectedLayer}.`, "SCHEMA");
    }
    if (isOtherCode(beat.code, beat.layer) && !beat.other_explanation?.trim()) {
      throw new ExtractValidationError(`Beat ${beat.order_index} uses ${beat.code} without other_explanation; explain what the beat does in one sentence.`, "SCHEMA");
    }
  }

  const gateSegments: GateSegment[] = input.segments.map((segment) => ({
    id: segment.id,
    channel: segment.channel,
    orderIndex: segment.orderIndex,
    tStart: segment.tStart,
    tEnd: segment.tEnd,
    text: segment.text,
    confidence: segment.confidence,
  }));
  const gate = gateBeats(
    beats.map((beat) => ({ orderIndex: beat.order_index, evidenceQuote: beat.evidence_quote, channel: beat.channel, tStart: beat.t_start, tEnd: beat.t_end })),
    gateSegments,
    { threshold: input.threshold, transcriptEnd: input.transcriptEnd },
  );
  if (!gate.ok) {
    const quoteProblem = gate.errors.some((error) => /not a near-exact|declares channel/.test(error));
    throw new ExtractValidationError(gate.errors.slice(0, 5).join(" "), quoteProblem ? "EVIDENCE_GATE" : "TIMECODE", gate);
  }

  const byIndex = new Map(gate.perBeat.map((item) => [item.orderIndex, item]));
  return {
    format: normalizeFormat(parsed.data.format),
    gate,
    beats: beats.map((beat) => {
      const result = byIndex.get(beat.order_index)!;
      return {
        orderIndex: beat.order_index,
        layer: beat.layer,
        code: beat.code,
        startSec: beat.t_start,
        endSec: beat.t_end,
        evidenceQuote: beat.evidence_quote,
        channel: result.matchedChannel ?? beat.channel,
        otherExplanation: beat.other_explanation?.trim() || null,
        matchScore: result.matchScore,
        matchedSegmentId: result.matchedSegmentId,
        lowConfidenceEvidence: result.lowConfidenceEvidence,
      };
    }),
  };
}
