// Gate 1 — pure half. Turns a hand-decomposed gold ad into the transcript
// shape the extractor expects (so it runs blind with the production prompt) and
// scores the agreement between gold beats and predicted beats.

import { collapse } from "./mine";
import type { TranscriptSegment } from "./transcribe";

export type PseudoSegment = TranscriptSegment & { id: string };

const WORDS_PER_SECOND = 2.5;

/**
 * Sentence-split the gold script into a vo-only transcript with timecodes
 * proportional to character offsets. When the gold ad has no duration, one is
 * synthesised from a 2.5 words/second speaking rate.
 */
export function goldToPseudoTranscript(scriptText: string, durationSec: number | null): { segments: PseudoSegment[]; durationSec: number; synthetic: boolean } {
  const sentences = scriptText
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.match(/[^.!?]+[.!?]?/g) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const totalChars = Math.max(1, sentences.reduce((sum, sentence) => sum + sentence.length, 0));
  const words = scriptText.split(/\s+/).filter(Boolean).length;
  const synthetic = !durationSec || durationSec <= 0;
  const duration = synthetic ? Math.max(5, Math.round((words / WORDS_PER_SECOND) * 10) / 10) : durationSec!;
  let cursor = 0;
  const segments: PseudoSegment[] = sentences.map((text, orderIndex) => {
    const tStart = Math.round((cursor / totalChars) * duration * 10) / 10;
    cursor += text.length;
    const tEnd = Math.max(tStart + 0.1, Math.round((cursor / totalChars) * duration * 10) / 10);
    return { id: `gold_${orderIndex}`, channel: "vo" as const, orderIndex, tStart, tEnd, text, confidence: 1 };
  });
  return { segments, durationSec: duration, synthetic };
}

export type BeatLabel = { orderIndex: number; layer: string; code: string };

export type BeatComparison = {
  layerAgreement: number;
  codeAgreement: number;
  orderAgreement: number | null;
  goldLayers: string[];
  predictedLayers: string[];
  goldCodes: string[];
  predictedCodes: string[];
  /** gold layer → predicted layer counts for mismatches, aligned by position. */
  confusion: Record<string, number>;
};

export function lcsLength(a: string[], b: string[]): number {
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? (previous[j - 1] ?? 0) + 1 : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return previous[b.length] ?? 0;
}

function ordered(beats: BeatLabel[]): BeatLabel[] {
  return [...beats].sort((a, b) => a.orderIndex - b.orderIndex);
}

/** Position-tolerant agreement between two decompositions of the same ad. */
export function compareBeats(gold: BeatLabel[], predicted: BeatLabel[]): BeatComparison {
  const goldLayers = collapse(ordered(gold).map((beat) => beat.layer));
  const predictedLayers = collapse(ordered(predicted).map((beat) => beat.layer));
  const goldCodes = collapse(ordered(gold).map((beat) => beat.code));
  const predictedCodes = collapse(ordered(predicted).map((beat) => beat.code));
  const layerAgreement = goldLayers.length ? lcsLength(goldLayers, predictedLayers) / Math.max(goldLayers.length, predictedLayers.length) : 0;
  const codeAgreement = goldCodes.length ? lcsLength(goldCodes, predictedCodes) / Math.max(goldCodes.length, predictedCodes.length) : 0;

  const firstGold = new Map<string, number>();
  goldCodes.forEach((code, index) => { if (!firstGold.has(code)) firstGold.set(code, index); });
  const firstPredicted = new Map<string, number>();
  predictedCodes.forEach((code, index) => { if (!firstPredicted.has(code)) firstPredicted.set(code, index); });
  const shared = [...firstGold.keys()].filter((code) => firstPredicted.has(code));
  let pairs = 0;
  let agreeing = 0;
  for (let i = 0; i < shared.length; i += 1) {
    for (let j = i + 1; j < shared.length; j += 1) {
      const a = shared[i]!;
      const b = shared[j]!;
      pairs += 1;
      const goldOrder = Math.sign(firstGold.get(a)! - firstGold.get(b)!);
      const predictedOrder = Math.sign(firstPredicted.get(a)! - firstPredicted.get(b)!);
      if (goldOrder === predictedOrder) agreeing += 1;
    }
  }
  const orderAgreement = pairs ? agreeing / pairs : null;

  const confusion: Record<string, number> = {};
  const goldOrdered = ordered(gold);
  const predictedOrdered = ordered(predicted);
  const width = Math.min(goldOrdered.length, predictedOrdered.length);
  for (let i = 0; i < width; i += 1) {
    const g = goldOrdered[i]!.layer;
    const p = predictedOrdered[i]!.layer;
    if (g !== p) confusion[`${g}→${p}`] = (confusion[`${g}→${p}`] ?? 0) + 1;
  }

  return { layerAgreement: round3(layerAgreement), codeAgreement: round3(codeAgreement), orderAgreement: orderAgreement == null ? null : round3(orderAgreement), goldLayers, predictedLayers, goldCodes, predictedCodes, confusion };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type EvalAdResult = {
  externalId: string;
  title: string;
  quarantined: boolean;
  error: string | null;
  comparison: BeatComparison | null;
  attempts: number;
};

export type EvalSummary = {
  goldAdCount: number;
  quarantined: number;
  layerAgreement: number | null;
  codeAgreement: number | null;
  orderAgreement: number | null;
  confusion: Record<string, number>;
  worst: Array<{ externalId: string; layerAgreement: number; codeAgreement: number }>;
};

function mean(values: number[]): number | null {
  return values.length ? round3(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

/** Quarantined ads count as zero agreement — the extractor produced nothing usable for them. */
export function summarizeEval(results: EvalAdResult[]): EvalSummary {
  const layer = results.map((result) => result.comparison?.layerAgreement ?? 0);
  const code = results.map((result) => result.comparison?.codeAgreement ?? 0);
  const order = results.flatMap((result) => (result.comparison?.orderAgreement == null ? [] : [result.comparison.orderAgreement]));
  const confusion: Record<string, number> = {};
  for (const result of results) {
    for (const [key, count] of Object.entries(result.comparison?.confusion ?? {})) confusion[key] = (confusion[key] ?? 0) + count;
  }
  const worst = results
    .map((result) => ({ externalId: result.externalId, layerAgreement: result.comparison?.layerAgreement ?? 0, codeAgreement: result.comparison?.codeAgreement ?? 0 }))
    .sort((a, b) => a.layerAgreement + a.codeAgreement - (b.layerAgreement + b.codeAgreement))
    .slice(0, 5);
  return {
    goldAdCount: results.length,
    quarantined: results.filter((result) => result.quarantined).length,
    layerAgreement: mean(layer),
    codeAgreement: mean(code),
    orderAgreement: mean(order),
    confusion,
    worst,
  };
}
