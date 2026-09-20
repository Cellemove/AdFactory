// The evidence gate. After EXTRACT, every beat's evidence_quote must be a
// near-exact substring of a transcript segment (fuzzy partial ratio ≥ 90) and
// its timecodes must sit inside the quoted segment. Without this the model will
// populate a proof beat on an ad that contains no proof, because an empty list
// displeases it. Zero dependencies: normalisation, Levenshtein, and a
// token-boundary sliding window (the fuzzywuzzy partial_ratio idea).

import { EVIDENCE_GATE_THRESHOLD, type TranscriptChannel } from "./constants";

export type GateSegment = {
  id: string;
  channel: TranscriptChannel;
  orderIndex: number;
  tStart: number;
  tEnd: number;
  text: string;
  confidence?: number | null;
};

export type GateBeat = {
  orderIndex: number;
  evidenceQuote: string;
  channel: TranscriptChannel;
  tStart: number;
  tEnd: number;
};

export type BeatGateResult = {
  orderIndex: number;
  matchScore: number;
  matchedSegmentId: string | null;
  matchedChannel: TranscriptChannel | null;
  segmentSpan: [number, number] | null;
  lowConfidenceEvidence: boolean;
  /** Set when the quote matched but the beat's timecodes missed it: the matched segment's real span. */
  repairedSpan: [number, number] | null;
  errors: string[];
};

export type GateReport = {
  ok: boolean;
  threshold: number;
  errors: string[];
  /** Problems the gate fixed itself from the transcript. They never cost a model retry. */
  warnings: string[];
  perBeat: BeatGateResult[];
};

// ─── Normalisation ───────────────────────────────────────────────────────────

/** Case, punctuation, curly quotes and spacing must not decide a match. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(value: string): string[] {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

// ─── Similarity ──────────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

/** 0..100 similarity of two already-normalised strings. */
export function ratio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 100;
  return Math.round(100 * (1 - levenshtein(a, b) / longest));
}

/**
 * Best similarity of `needle` against any window of `hay` roughly the needle's
 * length, snapped to token boundaries. Exact containment short-circuits to 100.
 * Inputs may be raw; both are normalised here.
 */
export function partialRatio(needle: string, hay: string): number {
  const n = normalizeForMatch(needle);
  const h = normalizeForMatch(hay);
  if (!n.length) return 0;
  if (h.includes(n)) return 100;
  if (h.length <= n.length) return ratio(n, h);

  const slack = 8;
  let best = 0;
  // Token start positions in the haystack.
  const starts: number[] = [0];
  for (let i = 0; i < h.length; i += 1) if (h[i] === " ") starts.push(i + 1);
  for (const start of starts) {
    const minEnd = Math.min(h.length, start + Math.max(1, n.length - slack));
    const maxEnd = Math.min(h.length, start + n.length + slack);
    // Snap the window end to the next space so windows are whole tokens.
    for (let end = minEnd; end <= maxEnd; end += 1) {
      if (end !== h.length && h[end] !== " ") continue;
      const score = ratio(n, h.slice(start, end));
      if (score > best) best = score;
      if (best === 100) return 100;
    }
  }
  return best;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// ─── Segment matching ────────────────────────────────────────────────────────

export type SegmentMatch = {
  score: number;
  segmentId: string | null;
  channel: TranscriptChannel | null;
  span: [number, number] | null;
  lowConfidence: boolean;
};

/**
 * The transcript segment (or adjacent pair) a quote most likely came from.
 * A cheap token-overlap prefilter keeps the Levenshtein work proportional to
 * the number of plausible candidates rather than the whole transcript.
 */
export function bestSegmentMatch(quote: string, segments: GateSegment[], channel: TranscriptChannel, window?: [number, number]): SegmentMatch {
  const inChannel = segments.filter((segment) => segment.channel === channel).sort((a, b) => a.orderIndex - b.orderIndex);
  const quoteTokens = tokens(quote);
  type Candidate = { text: string; first: GateSegment; span: [number, number]; lowConfidence: boolean };
  // Single segments first, adjacent pairs after: on an equal score the
  // tightest span wins, so timecode checks compare against the real segment.
  const candidates: Candidate[] = inChannel.map((segment) => ({
    text: segment.text,
    first: segment,
    span: [segment.tStart, segment.tEnd],
    lowConfidence: (segment.confidence ?? 1) < 0.6,
  }));
  inChannel.forEach((segment, index) => {
    const next = inChannel[index + 1];
    if (next && !normalizeForMatch(segment.text).includes(normalizeForMatch(quote)) && !normalizeForMatch(next.text).includes(normalizeForMatch(quote))) {
      candidates.push({
        text: `${segment.text} ${next.text}`,
        first: segment,
        span: [segment.tStart, Math.max(segment.tEnd, next.tEnd)],
        lowConfidence: (segment.confidence ?? 1) < 0.6 || (next.confidence ?? 1) < 0.6,
      });
    }
  });

  let best: SegmentMatch = { score: 0, segmentId: null, channel: null, span: null, lowConfidence: false };
  const plausible = candidates.filter((candidate) => jaccard(quoteTokens, tokens(candidate.text)) >= 0.25);
  const ranked = plausible.length ? plausible : candidates;
  // Repeated copy must match the occurrence at this beat's time, not the first one.
  if (window) ranked.sort((a, b) => {
    const distance = (span: [number, number]) => Math.max(0, span[0] - window[1], window[0] - span[1]);
    return distance(a.span) - distance(b.span) || (a.span[1] - a.span[0]) - (b.span[1] - b.span[0]);
  });
  for (const candidate of ranked) {
    const score = partialRatio(quote, candidate.text);
    if (score > best.score) {
      best = { score, segmentId: candidate.first.id, channel, span: candidate.span, lowConfidence: candidate.lowConfidence };
      if (score === 100) break;
    }
  }
  return best;
}

// ─── The gate ────────────────────────────────────────────────────────────────

const END_TOLERANCE_SEC = 1.0;
const OVERLAP_TOLERANCE_SEC = 1.5;
const ORDER_TOLERANCE_SEC = 0.5;

function shortQuote(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

export function gateBeats(
  beats: GateBeat[],
  segments: GateSegment[],
  options: { threshold?: number; transcriptEnd: number },
): GateReport {
  const threshold = options.threshold ?? EVIDENCE_GATE_THRESHOLD;
  const errors: string[] = [];
  const warnings: string[] = [];
  const perBeat: BeatGateResult[] = [];
  const ordered = [...beats].sort((a, b) => a.orderIndex - b.orderIndex);
  // Start time after any repair, so the order check below judges the real position.
  const effectiveStart = new Map<number, number>();

  for (const beat of ordered) {
    const beatErrors: string[] = [];
    let match = bestSegmentMatch(beat.evidenceQuote, segments, beat.channel, [beat.tStart, beat.tEnd]);
    if (match.score < threshold) {
      const other: TranscriptChannel = beat.channel === "vo" ? "ost" : "vo";
      const crossed = bestSegmentMatch(beat.evidenceQuote, segments, other, [beat.tStart, beat.tEnd]);
      if (crossed.score >= threshold) {
        // The transcript already says which channel the words are in; the caller
        // takes matchedChannel, so asking the model again would buy nothing.
        warnings.push(`Beat ${beat.orderIndex} declared channel "${beat.channel}"; its evidence_quote is in "${other}" — corrected.`);
        match = crossed;
      } else {
        beatErrors.push(`Beat ${beat.orderIndex} evidence_quote "${shortQuote(beat.evidenceQuote)}" is not a near-exact transcript substring (best ${match.score} in ${beat.channel}); copy the exact words from one segment.`);
      }
    }

    if (!(beat.tStart >= 0)) beatErrors.push(`Beat ${beat.orderIndex} t_start must be ≥ 0.`);
    if (!(beat.tEnd > beat.tStart)) beatErrors.push(`Beat ${beat.orderIndex} t_end must be greater than t_start.`);
    if (beat.tEnd > options.transcriptEnd + END_TOLERANCE_SEC) {
      beatErrors.push(`Beat ${beat.orderIndex} ends at ${beat.tEnd}s but the transcript ends at ${options.transcriptEnd}s.`);
    }
    let repairedSpan: [number, number] | null = null;
    if (match.span && match.score >= threshold) {
      const [segStart, segEnd] = match.span;
      const overlaps = beat.tStart <= segEnd + OVERLAP_TOLERANCE_SEC && beat.tEnd >= segStart - OVERLAP_TOLERANCE_SEC;
      // Copy that is said more than once cannot be placed by its words alone, so
      // only a quote with a single home in the transcript is snapped; a repeated
      // line with drifted timecodes still goes back to the model.
      const occurrences = segments.filter((segment) => segment.channel === match.channel && partialRatio(beat.evidenceQuote, segment.text) >= threshold).length;
      if (!overlaps && occurrences <= 1) {
        // The quote is verified against a timed segment, so the segment's span is
        // better evidence of where the beat sits than the model's drifted guess.
        repairedSpan = [segStart, segEnd];
        warnings.push(`Beat ${beat.orderIndex} timecodes ${beat.tStart}-${beat.tEnd}s missed its quoted segment; snapped to ${segStart}-${segEnd}s.`);
      } else if (!overlaps) {
        beatErrors.push(`Beat ${beat.orderIndex} timecodes ${beat.tStart}-${beat.tEnd}s do not overlap the quoted segment (${segStart}-${segEnd}s), and that line occurs ${occurrences} times; give the timecodes of the occurrence you mean.`);
      }
    }
    effectiveStart.set(beat.orderIndex, repairedSpan ? repairedSpan[0] : beat.tStart);

    perBeat.push({
      orderIndex: beat.orderIndex,
      matchScore: match.score,
      matchedSegmentId: match.score >= threshold ? match.segmentId : null,
      matchedChannel: match.score >= threshold ? match.channel : null,
      segmentSpan: match.score >= threshold ? match.span : null,
      lowConfidenceEvidence: match.lowConfidence,
      repairedSpan,
      errors: beatErrors,
    });
    errors.push(...beatErrors);
  }

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    const currentStart = effectiveStart.get(current.orderIndex) ?? current.tStart;
    const previousStart = effectiveStart.get(previous.orderIndex) ?? previous.tStart;
    if (currentStart < previousStart - ORDER_TOLERANCE_SEC) {
      errors.push(`Beats are not in time order: beat ${current.orderIndex} starts at ${currentStart}s before beat ${previous.orderIndex} at ${previousStart}s.`);
      break;
    }
  }

  return { ok: errors.length === 0, threshold, errors, warnings, perBeat };
}
