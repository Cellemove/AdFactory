// winnerScore — a longevity RANKING, not a performance truth. The Ad Library
// exposes no results, so the proxy is: how long the ad ran (heaviest), how
// many near-duplicate variants the advertiser cut, how many placements it
// bought, and how often the brand re-used the same concept. Pure and monotone
// in every input so it can be unit-tested and explained.

import type { Json } from "@/lib/database.types";
import { WINNER_SCORE_VERSION } from "./constants";
import { tokens } from "./evidence-gate";

export type WinnerScoreInputs = {
  daysActive: number;
  variantCount: number;
  placementBreadth: number;
  conceptReuse: number;
};

export type WinnerScoreBreakdown = WinnerScoreInputs & {
  d: number;
  v: number;
  p: number;
  r: number;
  version: string;
};

const DAYS_SATURATION = 180;
const VARIANT_SATURATION = 6;
const PLACEMENT_MAX = 5;
const REUSE_SATURATION = 4;
const WEIGHTS = { d: 0.55, v: 0.2, p: 0.1, r: 0.15 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeWinnerScore(inputs: WinnerScoreInputs): { score: number; breakdown: WinnerScoreBreakdown } {
  const d = clamp01(Math.log1p(Math.max(0, inputs.daysActive)) / Math.log1p(DAYS_SATURATION));
  const v = clamp01(Math.log1p(Math.max(0, inputs.variantCount)) / Math.log1p(VARIANT_SATURATION));
  const p = clamp01(Math.max(0, inputs.placementBreadth - 1) / (PLACEMENT_MAX - 1));
  const r = clamp01(Math.max(0, inputs.conceptReuse) / REUSE_SATURATION);
  const score = Math.round(100 * (WEIGHTS.d * d + WEIGHTS.v * v + WEIGHTS.p * p + WEIGHTS.r * r) * 100) / 100;
  return { score, breakdown: { ...inputs, d, v, p, r, version: WINNER_SCORE_VERSION } };
}

type AdForScoring = {
  id: string;
  brandName: string;
  copy: string;
  startedAt: string | null;
  endedAt: string | null;
  lastSeenAt: string;
  metrics: Json;
  rawPayload: Json;
};

function numberField(payload: Json, key: string): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayLength(payload: Json, key: string): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : null;
}

export function daysActiveOf(ad: Pick<AdForScoring, "startedAt" | "endedAt" | "lastSeenAt" | "metrics">): number {
  const reported = numberField(ad.metrics, "totalActiveTimeSec");
  if (reported != null && reported > 0) return reported / 86_400;
  if (ad.startedAt) {
    const start = Date.parse(ad.startedAt);
    const end = Date.parse(ad.endedAt ?? ad.lastSeenAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 86_400_000;
  }
  return 0;
}

/** First dozen normalised words of the primary text: two ads sharing it are the same concept. */
export function conceptFingerprint(copy: string): string {
  return tokens(copy).slice(0, 12).join(" ");
}

/** Score every ad in a set; conceptReuse counts same-brand siblings with the same fingerprint. */
export function rankWinnerScores(ads: AdForScoring[]): Map<string, { score: number; breakdown: WinnerScoreBreakdown }> {
  const fingerprints = new Map<string, number>();
  for (const ad of ads) {
    const print = conceptFingerprint(ad.copy);
    if (!print) continue;
    const key = `${ad.brandName.toLowerCase()}|${print}`;
    fingerprints.set(key, (fingerprints.get(key) ?? 0) + 1);
  }
  const out = new Map<string, { score: number; breakdown: WinnerScoreBreakdown }>();
  for (const ad of ads) {
    const print = conceptFingerprint(ad.copy);
    const siblings = print ? (fingerprints.get(`${ad.brandName.toLowerCase()}|${print}`) ?? 1) - 1 : 0;
    out.set(ad.id, computeWinnerScore({
      daysActive: daysActiveOf(ad),
      variantCount: numberField(ad.metrics, "duplicateCount") ?? 0,
      placementBreadth: arrayLength(ad.rawPayload, "platforms") ?? 1,
      conceptReuse: siblings,
    }));
  }
  return out;
}

export const WINNER_SCORE_LABEL = "Longevity rank — a ranking proxy from days active, variants, placements and concept reuse; not a measured performance result.";

export function rankLabel(rank: number, total: number): string {
  return `Longevity rank #${rank} of ${total}`;
}
