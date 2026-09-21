// PLAYBOOK — one competitor's way of making ads, mined from its corpus, in the
// shape the strategist's script board uses: a spine of named beats with
// typical timings, each beat with real lines (voiceover, on-screen text and
// the visual on screen at that moment), the hooks the brand opens with, its
// formats and concepts, and the copywriting rules it follows. Every number is
// counted and every quote is real. Pure: the loading lives in playbook.server.ts.

import { copyProfile, type CopyAd, type CopyProfile } from "./copy-rules";
import type { TaxonomyEntry } from "./extract";
import { median } from "./mine";
import type { CorpusPatternReportJson } from "./report";

export const PLAYBOOK_ENGINE_VERSION = "playbook-v1";

export type PlaybookAd = CopyAd & {
  brand: string;
  formatTag: string | null;
  angleTag: string | null;
  durationSec: number | null;
  /** What was on screen, shot by shot. */
  visuals: Array<{ tStart: number; tEnd: number; text: string }>;
  beats: Array<CopyAd["beats"][number] & { endSec: number | null; channel: string }>;
};

export type PlaybookExample = {
  adId: string;
  tStart: number | null;
  tEnd: number | null;
  /** The beat's quoted words. */
  quote: string;
  channel: string;
  /** On-screen text shown during the beat, if any. */
  onScreen: string | null;
  /** What was on screen during the beat, if the transcript recorded it. */
  visual: string | null;
};

export type PlaybookBeat = {
  code: string;
  layer: string;
  label: string;
  description: string;
  ads: number;
  share: number;
  /** Typical placement, seconds from the start, and typical length. */
  medianStartSec: number | null;
  medianDurationSec: number | null;
  examples: PlaybookExample[];
};

export type PlaybookSpineStep = {
  code: string;
  layer: string;
  label: string;
  /** Typical window in seconds, from the median start and duration across the ads that use it. */
  window: [number, number] | null;
};

export type PlaybookShare = { name: string; ads: number; share: number };

export type PlaybookLaw = { law: string; share: number; ads: number };

export type BrandPlaybook = {
  researchMode?: "speech_only" | "full_video";
  engineVersion: string;
  taxonomyVersion: string;
  brand: string;
  adCount: number;
  coverage?: { analyzedAds: number; totalAds: number };
  generatedAt: string;
  selection: string;
  medianDurationSec: number | null;
  spine: { steps: PlaybookSpineStep[]; ads: number; share: number } | null;
  hooks: PlaybookBeat[];
  beats: PlaybookBeat[];
  formats: PlaybookShare[];
  concepts: PlaybookShare[];
  laws: PlaybookLaw[];
  copy: CopyProfile;
  caveats: string[];
};

export type PlaybookOptions = {
  taxonomyVersion: string;
  /** Beats used by fewer ads than this are left out of the beat library. */
  minSupport?: number;
  examplesPerBeat?: number;
  now?: Date;
};

const LAYER_NAME: Record<string, string> = { H: "Hook", Q: "Qualify", P: "Pain", B: "Belief", M: "Mechanism", PR: "Proof", O: "Offer", OTHER: "Other" };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function byRank<T extends { winnerScore: number | null }>(ads: T[]): T[] {
  return [...ads].sort((a, b) => (b.winnerScore ?? -1) - (a.winnerScore ?? -1));
}

/** The on-screen text and the visual note that overlap a beat's window. */
function context(ad: PlaybookAd, startSec: number | null, endSec: number | null): { onScreen: string | null; visual: string | null } {
  if (startSec == null) return { onScreen: null, visual: null };
  const end = endSec ?? startSec + 3;
  const overlaps = (tStart: number, tEnd: number) => tStart <= end + 0.5 && tEnd >= startSec - 0.5;
  const onScreen = ad.lines.filter((line) => line.channel === "ost" && overlaps(line.tStart, line.tStart + 2)).map((line) => line.text).join(" / ") || null;
  const visual = ad.visuals.filter((shot) => overlaps(shot.tStart, shot.tEnd)).map((shot) => shot.text).join(" ") || null;
  return { onScreen, visual };
}

function shares(ads: PlaybookAd[], pick: (ad: PlaybookAd) => string | null): PlaybookShare[] {
  const counts = new Map<string, number>();
  for (const ad of ads) {
    const key = pick(ad);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, ads: count, share: ads.length ? count / ads.length : 0 }))
    .sort((a, b) => b.ads - a.ads || a.name.localeCompare(b.name));
}

/** Beat library: every code the brand uses, with placement, length and proofs from its best ads. */
export function beatLibrary(ads: PlaybookAd[], taxonomy: TaxonomyEntry[], options: { minSupport: number; examplesPerBeat: number }): PlaybookBeat[] {
  const entries = new Map(taxonomy.map((entry) => [entry.code, entry]));
  const byCode = new Map<string, Array<{ ad: PlaybookAd; beat: PlaybookAd["beats"][number] }>>();
  for (const ad of byRank(ads)) {
    const seen = new Set<string>();
    for (const beat of [...ad.beats].sort((a, b) => a.orderIndex - b.orderIndex)) {
      // One example per ad per code, so a single ad cannot dominate a beat's proofs.
      if (seen.has(beat.code)) continue;
      seen.add(beat.code);
      byCode.set(beat.code, [...(byCode.get(beat.code) ?? []), { ad, beat }]);
    }
  }
  const library: PlaybookBeat[] = [];
  for (const [code, uses] of byCode) {
    if (uses.length < options.minSupport) continue;
    const entry = entries.get(code);
    const starts = uses.map((use) => use.beat.startSec).filter((value): value is number => value != null);
    const durations = uses.map((use) => (use.beat.startSec != null && use.beat.endSec != null ? use.beat.endSec - use.beat.startSec : null)).filter((value): value is number => value != null && value >= 0);
    library.push({
      code,
      layer: uses[0]!.beat.layer,
      label: entry?.label ?? code,
      description: entry?.description ?? "",
      ads: uses.length,
      share: uses.length / ads.length,
      medianStartSec: median(starts) == null ? null : round1(median(starts)!),
      medianDurationSec: median(durations) == null ? null : round1(median(durations)!),
      examples: uses.slice(0, options.examplesPerBeat).map(({ ad, beat }) => ({
        adId: ad.id,
        tStart: beat.startSec,
        tEnd: beat.endSec,
        quote: beat.evidenceQuote,
        channel: beat.channel,
        ...context(ad, beat.startSec, beat.endSec),
      })),
    });
  }
  return library.sort((a, b) => b.ads - a.ads || (a.medianStartSec ?? 0) - (b.medianStartSec ?? 0));
}

/**
 * The spine: the brand's most common full sequence of codes (from the mined
 * report), each step given the typical window of that code across the ads.
 */
export function spineFrom(report: CorpusPatternReportJson | null, library: PlaybookBeat[], adCount: number): BrandPlaybook["spine"] {
  const top = report?.sequences.codeSpines.find((row) => row.pattern.length >= 3) ?? report?.sequences.codeSpines[0];
  if (!top) return null;
  const byCode = new Map(library.map((beat) => [beat.code, beat]));
  const steps: PlaybookSpineStep[] = top.pattern.map((code) => {
    const beat = byCode.get(code);
    const window: [number, number] | null = beat && beat.medianStartSec != null
      ? [beat.medianStartSec, round1(beat.medianStartSec + (beat.medianDurationSec ?? 3))]
      : null;
    return { code, layer: beat?.layer ?? code.split("_")[0] ?? "OTHER", label: beat?.label ?? code, window };
  });
  return { steps, ads: top.support, share: adCount ? top.support / adCount : top.share };
}

/** Order rules in plain words, from the mined positional laws. */
export function lawsFrom(report: CorpusPatternReportJson | null, taxonomy: TaxonomyEntry[]): PlaybookLaw[] {
  if (!report) return [];
  const label = (code: string) => taxonomy.find((entry) => entry.code === code)?.label ?? LAYER_NAME[code] ?? code;
  const layerLaws = report.positionalLaws.layers.filter((row) => row.law).map((row) => ({ law: `${LAYER_NAME[row.x] ?? row.x} comes before ${LAYER_NAME[row.y] ?? row.y}`, share: row.share, ads: row.support }));
  const codeLaws = report.positionalLaws.codes.filter((row) => row.law).map((row) => ({ law: `"${label(row.x)}" comes before "${label(row.y)}"`, share: row.share, ads: row.support }));
  return [...layerLaws, ...codeLaws].sort((a, b) => b.share - a.share || b.ads - a.ads).slice(0, 12);
}

export function buildPlaybook(input: { brand: string; ads: PlaybookAd[]; taxonomy: TaxonomyEntry[]; report: CorpusPatternReportJson | null; totalAds?: number }, options: PlaybookOptions): BrandPlaybook {
  const minSupport = options.minSupport ?? 3;
  const examplesPerBeat = options.examplesPerBeat ?? 3;
  const ads = input.ads;
  const library = beatLibrary(ads, input.taxonomy, { minSupport, examplesPerBeat });
  const durations = ads.map((ad) => ad.durationSec).filter((value): value is number => value != null);
  const caveats: string[] = [];
  const totalAds = input.totalAds ?? ads.length;
  if (ads.length < totalAds) caveats.push(`Preliminary playbook: ${ads.length} of ${totalAds} ads analyzed. Missing and unverified ads are excluded; patterns may change as coverage grows.`);
  if (ads.length < 20) caveats.push(`Only ${ads.length} ads: percentages move a lot with each ad. Treat rules as leads until the brand has 50+.`);
  const withVisuals = ads.filter((ad) => ad.visuals.length).length;
  if (withVisuals < ads.length) caveats.push(`${ads.length - withVisuals} ad(s) were transcribed before visual direction was captured; their examples show words only.`);
  if (!input.report) caveats.push("No pattern report for this brand yet, so the spine and order rules are missing — run 'Find the patterns'.");

  return {
    engineVersion: PLAYBOOK_ENGINE_VERSION,
    taxonomyVersion: options.taxonomyVersion,
    brand: input.brand,
    adCount: ads.length,
    coverage: { analyzedAds: ads.length, totalAds },
    generatedAt: (options.now ?? new Date()).toISOString(),
    selection: "Winning ads: still running 3+ weeks after launch, highest spend first",
    medianDurationSec: median(durations) == null ? null : round1(median(durations)!),
    spine: spineFrom(input.report, library, ads.length),
    hooks: library.filter((beat) => beat.layer === "H"),
    beats: library.filter((beat) => beat.layer !== "H"),
    formats: shares(ads, (ad) => ad.formatTag),
    concepts: shares(ads, (ad) => ad.angleTag),
    laws: lawsFrom(input.report, input.taxonomy),
    copy: copyProfile(ads, { minSupport }),
    caveats,
  };
}
