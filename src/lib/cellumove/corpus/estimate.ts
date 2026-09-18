// What a pipeline run will cost and how long it will take, so the page can say
// so before spending anything. Estimates only — every number here is observed,
// not billed, and the UI must label it as an estimate. Edit the constants here
// rather than hard-coding figures into components.

/** 1 BrandSearch credit per ad fetched. */
export const CREDITS_PER_AD = 1;

/**
 * Measured Gemini spend per ad on real runs (Sept 2026): transcription averaged
 * $0.087 (range $0.033-$0.212, driven by video length), beats $0.060.
 */
const TRANSCRIBE_USD_PER_AD = { low: 0.04, high: 0.15 };
const EXTRACT_USD_PER_AD = { low: 0.04, high: 0.09 };

/** Wall-clock per ad, before dividing by the lanes each stage runs on. Transcription measured at ~50s. */
const SECONDS_PER_AD = { media: 3, transcribe: 50, extract: 35 };
const LANES = { media: 3, transcribe: 2, extract: 2 };

/** Teardown's own deep-dive, quoted separately because it is a separate button. */
export const TEARDOWN_USD_PER_AD = 0.2;

export type RunEstimate = {
  ads: number;
  credits: number;
  usdLow: number;
  usdHigh: number;
  minutesLow: number;
  minutesHigh: number;
};

export function estimateRun(input: { ads: number; includeCollect: boolean }): RunEstimate {
  const ads = Math.max(0, Math.round(input.ads));
  const usdPerAd = {
    low: TRANSCRIBE_USD_PER_AD.low + EXTRACT_USD_PER_AD.low,
    high: TRANSCRIBE_USD_PER_AD.high + EXTRACT_USD_PER_AD.high,
  };
  const secondsPerAd = SECONDS_PER_AD.media / LANES.media
    + SECONDS_PER_AD.transcribe / LANES.transcribe
    + SECONDS_PER_AD.extract / LANES.extract;
  const minutes = (ads * secondsPerAd) / 60;
  return {
    ads,
    credits: input.includeCollect ? ads * CREDITS_PER_AD : 0,
    usdLow: round(ads * usdPerAd.low),
    usdHigh: round(ads * usdPerAd.high),
    // Wide on purpose: model latency swings, and a promise of "12 minutes" that
    // takes 30 is worse than a range.
    minutesLow: Math.max(1, Math.round(minutes * 0.7)),
    minutesHigh: Math.max(2, Math.round(minutes * 1.6)),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatUsd(value: number): string {
  if (value <= 0) return "$0";
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

export function formatUsdRange(low: number, high: number): string {
  return low === high ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`;
}

export function formatMinutes(low: number, high: number): string {
  return low === high ? `${low} min` : `${low}–${high} min`;
}
