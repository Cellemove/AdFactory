// TRANSCRIBE — pure half. The prompt, the response contract, and the
// normalisation that turns a model transcript into clean two-channel segments.
//
// Two channels are mandatory. A large share of the copy in this category lives
// in text-on-screen, not voiceover; an audio-only transcript silently drops a
// third of the signal and every pattern mined downstream is then wrong.

import { z } from "zod";
import { TRANSCRIPT_CHANNELS, type TranscriptChannel } from "./constants";
import { normalizeForMatch, tokens } from "./evidence-gate";

export const TranscriptSegmentResponseSchema = z.object({
  channel: z.enum(TRANSCRIPT_CHANNELS),
  t_start: z.number().finite(),
  t_end: z.number().finite(),
  text: z.string(),
  confidence: z.number().min(0).max(1).nullish(),
});

export const TranscriptResponseSchema = z.object({
  duration_sec: z.number().finite().nonnegative(),
  language: z.string().trim().min(2).max(8).nullish(),
  segments: z.array(TranscriptSegmentResponseSchema),
});

export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;

export type TranscriptSegment = {
  channel: TranscriptChannel;
  orderIndex: number;
  tStart: number;
  tEnd: number;
  text: string;
  confidence: number | null;
};

export type NormalizedTranscript = {
  durationSec: number;
  language: string | null;
  segments: TranscriptSegment[];
};

export function buildTranscribePrompt(): string {
  return [
    "You are transcribing ONE paid social video ad for a structural analysis. This is mechanical transcription, not summarising.",
    "Watch and listen to the whole video. Return exactly one JSON object and no prose.",
    "",
    "Produce two channels:",
    '1. "vo" — every spoken word (voiceover or on-camera speech), verbatim, in the original language. Do not translate, do not clean up grammar, do not paraphrase. Split into short segments at natural pauses (roughly one sentence or 3-8 seconds each). Music lyrics are NOT vo unless they carry the ad\'s message.',
    '2. "ost" — every piece of on-screen text: captions burned into the video, headlines, price tags, stickers, product labels, CTA buttons. One entry per distinct text element at the moment it FIRST appears; never repeat the same text for later frames. Reproduce the exact characters shown, including numbers, currency symbols, emoji and casing. Do NOT include subtitles that merely duplicate the vo word-for-word; DO include them when the wording differs.',
    "",
    "Timecodes are seconds from the start of the video with one decimal (e.g. 12.4). t_end must be greater than t_start and no later than the video's end. Segments in each channel must be in time order and must not overlap.",
    'If a channel has no content, return an empty array for it. Never invent text you cannot see or hear; write "[inaudible]" for unclear speech.',
    "confidence is your 0..1 certainty that the text is exactly what was shown or said.",
    "",
    "Required shape:",
    '{"duration_sec": number, "language": "ISO 639-1 code of the dominant spoken language, or null", "segments": [{"channel": "vo" | "ost", "t_start": number, "t_end": number, "text": string, "confidence": number}]}',
  ].join("\n");
}

const OST_DEDUPE_WINDOW_SEC = 3;
const MIN_SEGMENT_SEC = 0.1;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Clean the model's transcript: clamp and order timecodes, drop empties,
 * collapse repeated on-screen captions to their first appearance, and derive
 * the duration. Throws when the timeline is impossible (caller retries once).
 */
export function normalizeTranscript(raw: TranscriptResponse): NormalizedTranscript {
  const segments: TranscriptSegment[] = [];
  for (const channel of TRANSCRIPT_CHANNELS) {
    const own = raw.segments
      .filter((segment) => segment.channel === channel)
      .map((segment) => {
        const tStart = round1(Math.max(0, segment.t_start));
        const tEnd = round1(Math.max(tStart + MIN_SEGMENT_SEC, segment.t_end));
        return { tStart, tEnd, text: segment.text.replace(/\s+/g, " ").trim(), confidence: segment.confidence ?? null };
      })
      .filter((segment) => segment.text && normalizeForMatch(segment.text) !== "inaudible")
      .sort((a, b) => a.tStart - b.tStart || a.tEnd - b.tEnd);

    const kept: typeof own = [];
    for (const segment of own) {
      if (channel === "ost") {
        const key = normalizeForMatch(segment.text);
        const previous = kept.find((item) => normalizeForMatch(item.text) === key && Math.abs(item.tStart - segment.tStart) <= OST_DEDUPE_WINDOW_SEC);
        if (previous) {
          previous.tEnd = Math.max(previous.tEnd, segment.tEnd);
          previous.confidence = previous.confidence == null || segment.confidence == null ? previous.confidence ?? segment.confidence : Math.max(previous.confidence, segment.confidence);
          continue;
        }
      }
      kept.push(segment);
    }
    kept.forEach((segment, orderIndex) => segments.push({ channel, orderIndex, ...segment }));
  }

  // A segment that starts well after the model's own declared duration means
  // the timeline is inconsistent — retry rather than silently stretch it.
  const late = raw.duration_sec > 0 ? segments.find((segment) => segment.tStart > raw.duration_sec + 2) : undefined;
  if (late) {
    throw new Error(`Segment "${late.text.slice(0, 40)}" starts at ${late.tStart}s, after the ${raw.duration_sec}s video.`);
  }
  const maxEnd = segments.reduce((max, segment) => Math.max(max, segment.tEnd), 0);
  const durationSec = round1(Math.max(raw.duration_sec, maxEnd));
  if (!segments.length) {
    throw new Error("The transcript has no segments in either channel.");
  }
  return { durationSec, language: raw.language?.toLowerCase() ?? null, segments };
}

/** One segment per line, the way EXTRACT sees the transcript. */
export function renderTranscript(segments: TranscriptSegment[]): string {
  return [...segments]
    .sort((a, b) => a.tStart - b.tStart || (a.channel === b.channel ? a.orderIndex - b.orderIndex : a.channel === "vo" ? -1 : 1))
    .map((segment) => `[${segment.channel} ${segment.tStart.toFixed(1)}-${segment.tEnd.toFixed(1)}] ${segment.text}`)
    .join("\n");
}

// ─── BrandSearch transcript cross-check ──────────────────────────────────────

/** Plain text, WebVTT/SRT, or JSON ({text} / [{text}] / {segments:[{text}]}) → plain text. */
export function parseBrandSearchTranscript(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const texts: string[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === "string") return;
        if (Array.isArray(value)) return value.forEach(walk);
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (typeof record.text === "string") texts.push(record.text);
          else if (typeof record.transcript === "string") texts.push(record.transcript);
          for (const [key, child] of Object.entries(record)) if (key !== "text" && key !== "transcript") walk(child);
        }
      };
      walk(parsed);
      if (texts.length) return texts.join(" ").replace(/\s+/g, " ").trim();
    } catch {
      /* fall through to the text path */
    }
  }
  return trimmed
    .split(/\r?\n/)
    .filter((line) => !/^WEBVTT/i.test(line) && !/^\d+$/.test(line.trim()) && !/\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->/.test(line) && !/^NOTE\b/.test(line))
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type TranscriptCrossCheck = {
  tokenOverlap: number;
  verdict: "agree" | "partial" | "diverge" | "unavailable";
  brandSearchTokens: number;
  voTokens: number;
};

/** How much of the provider's voice transcript the model's vo channel reproduces. Never blocks. */
export function crossCheckTranscript(voSegments: Array<{ text: string }>, brandSearchText: string | null): TranscriptCrossCheck {
  const reference = tokens(brandSearchText ?? "");
  const ours = tokens(voSegments.map((segment) => segment.text).join(" "));
  if (!reference.length || !ours.length) return { tokenOverlap: 0, verdict: "unavailable", brandSearchTokens: reference.length, voTokens: ours.length };
  const ourSet = new Set(ours);
  const shared = reference.filter((token) => ourSet.has(token)).length;
  const tokenOverlap = Math.round((shared / reference.length) * 1000) / 1000;
  const verdict = tokenOverlap >= 0.6 ? "agree" : tokenOverlap >= 0.35 ? "partial" : "diverge";
  return { tokenOverlap, verdict, brandSearchTokens: reference.length, voTokens: ours.length };
}
