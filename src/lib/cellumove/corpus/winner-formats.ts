// Reference formats derived from the corpus of winning ads.
//
// A seeded format ("Magic Formula") is somebody's idea of a good structure. These
// are measured: take the winners that share one trait — the big idea they hang on,
// or the way they open — and keep the beats most of them contain, in the order and
// at the share of the runtime where they actually appear. Pure and deterministic,
// so re-running it after more ads are broken down simply refreshes the formats.

import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";

export const WINNER_FORMATS_VERSION = "winner-formats-v1";

/** A cohort needs this many winners before a format is published from it. */
export const WINNER_FORMAT_MIN_ADS = 8;
/** A beat belongs to the format when at least this share of the cohort has it. */
const BEAT_MIN_SHARE = 0.45;
/** …or, to fill a long empty stretch, at least this share. */
const FILLER_MIN_SHARE = 0.25;
/** A stretch longer than this share of the runtime with no beat in it gets a filler. */
const GAP = 0.2;
const MAX_BEATS = 8;
const MIN_BEAT_SEC = 3;

export type WinnerFormatAd = {
  id: string;
  brand: string;
  formatTag: string | null;
  conceptTag: string | null;
  winnerScore: number | null;
  beats: Array<{ code: string; layer: string; orderIndex: number; startSec: number | null; endSec: number | null; quote?: string | null }>;
};

export type WinnerFormatTaxonomy = { code: string; layer: string; label: string; description: string };

export type DerivedWinnerFormat = {
  slug: string;
  name: string;
  description: string;
  bestForAngle: string;
  optimalDurationSec: number;
  beats: ReferenceFormatBeat[];
  exampleScripts: string[];
  adCount: number;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
};
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const runtimeOf = (ad: WinnerFormatAd) => Math.max(0, ...ad.beats.map((beat) => beat.endSec ?? 0));
const ordered = (ad: WinnerFormatAd) => [...ad.beats].sort((a, b) => a.orderIndex - b.orderIndex);

function topShare(values: Array<string | null>): { name: string; share: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? { name: best[0], share: best[1] / values.length } : null;
}

/** One format from one cohort of winners, or null when the cohort has no shared shape. */
function formatFrom(input: { name: string; slug: string; lens: string; bestFor: string; ads: WinnerFormatAd[]; taxonomy: Map<string, WinnerFormatTaxonomy> }): DerivedWinnerFormat | null {
  const ads = input.ads.filter((ad) => ad.beats.length >= 3 && runtimeOf(ad) > 0);
  if (ads.length < WINNER_FORMAT_MIN_ADS) return null;

  // Where, as a share of the runtime, each beat first appears — per ad.
  const positions = new Map<string, number[]>();
  for (const ad of ads) {
    const runtime = runtimeOf(ad);
    const seen = new Set<string>();
    for (const beat of ordered(ad)) {
      if (seen.has(beat.code) || beat.startSec == null) continue;
      seen.add(beat.code);
      positions.set(beat.code, [...(positions.get(beat.code) ?? []), beat.startSec / runtime]);
    }
  }
  const share = (code: string) => (positions.get(code)?.length ?? 0) / ads.length;
  const chosen = new Set([...positions.keys()].filter((code) => code !== "OTHER" && !code.endsWith("_OTHER") && share(code) >= BEAT_MIN_SHARE));
  // Hooks are varied, so no single hook reaches the bar on its own: a format still
  // needs an opening, and it is the hook these winners most often start with.
  const opening = topShare(ads.map((ad) => ordered(ad)[0]?.code ?? null));
  if (opening && input.taxonomy.has(opening.name)) chosen.add(opening.name);
  const placed = (code: string) => ({ code, at: code === opening?.name ? 0 : median(positions.get(code) ?? [1]), share: share(code) });
  let beats = [...chosen].map(placed).sort((a, b) => a.at - b.at || b.share - a.share);

  // The middle of an ad is where winners differ most, so no single beat there
  // reaches the bar and the beat before it would swallow the gap (a "20-second
  // hook"). Fill any stretch longer than GAP of the runtime with the most common
  // beat that really sits inside it, down to a lower share.
  const hookEnd = median(ads.map((ad) => (ordered(ad)[0]?.endSec ?? 0) / runtimeOf(ad)));
  for (let guard = 0; guard < MAX_BEATS && beats.length < MAX_BEATS; guard += 1) {
    const edges = [...beats.map((beat) => beat.at), 1];
    const gapAt = edges.findIndex((edge, index) => index > 0 && edge - Math.max(edges[index - 1]!, index === 1 ? hookEnd : 0) > GAP);
    if (gapAt === -1) break;
    const from = Math.max(edges[gapAt - 1]!, gapAt === 1 ? hookEnd : 0);
    const filler = [...positions.keys()]
      .filter((code) => !beats.some((beat) => beat.code === code) && code !== "OTHER" && !code.endsWith("_OTHER") && !code.startsWith("H_") && share(code) >= FILLER_MIN_SHARE)
      .map(placed)
      .filter((beat) => beat.at > from && beat.at < edges[gapAt]!)
      .sort((a, b) => b.share - a.share)[0];
    if (!filler) break;
    beats = [...beats, filler].sort((a, b) => a.at - b.at || b.share - a.share);
  }
  beats = beats.slice(0, MAX_BEATS);
  if (beats.length < 3) return null;

  const duration = Math.min(90, Math.max(20, Math.round(median(ads.map(runtimeOf)) / 5) * 5));
  // Start each beat where the winners start it, but never give a beat less than MIN_BEAT_SEC.
  const starts: number[] = [];
  // The opening lasts as long as the winners' openings really last; the beat after
  // it starts there, not wherever its own median happens to fall.
  const hookSec = Math.max(MIN_BEAT_SEC, Math.round(hookEnd * duration));
  beats.forEach((beat, index) => starts.push(index === 0 ? 0 : index === 1 ? hookSec : Math.max(Math.round(beat.at * duration), starts[index - 1]! + MIN_BEAT_SEC)));
  const total = Math.max(duration, starts[starts.length - 1]! + MIN_BEAT_SEC);

  const best = [...ads].sort((a, b) => (b.winnerScore ?? 0) - (a.winnerScore ?? 0));
  const quoteFor = (code: string) => best.flatMap((ad) => ad.beats).find((beat) => beat.code === code && beat.quote?.trim())?.quote?.trim() ?? null;
  const production = topShare(ads.map((ad) => ad.formatTag));
  const brands = [...new Set(ads.map((ad) => ad.brand))];
  const labelOf = (code: string) => input.taxonomy.get(code)?.label ?? code;

  return {
    slug: input.slug,
    name: input.name,
    description: `Measured from ${ads.length} winning ads (${brands.slice(0, 3).join(", ")}) that ${input.lens}. Typical flow: ${beats.map((beat) => labelOf(beat.code)).join(" → ")}.${production ? ` Mostly shot as ${production.name} (${Math.round(production.share * 100)}%).` : ""}`,
    bestForAngle: input.bestFor,
    optimalDurationSec: total,
    beats: beats.map((beat, index) => {
      const entry = input.taxonomy.get(beat.code);
      const quote = quoteFor(beat.code);
      return {
        label: labelOf(beat.code),
        time: `${starts[index]}–${index + 1 < starts.length ? starts[index + 1] : total}s`,
        note: `${entry?.description ?? "Do this beat's job."} In ${Math.round(beat.share * 100)}% of these winners.${quote ? ` A winner's version (for the job it does, never to copy): “${quote.slice(0, 160)}”` : ""}`,
      };
    }),
    // Competitor lines, kept as references: the originality audit compares drafts
    // with these, so a script that leans on one too closely is flagged.
    exampleScripts: best.slice(0, 2).map((ad) => ordered(ad).filter((beat) => beat.quote?.trim()).map((beat) => `[${Math.round(beat.startSec ?? 0)}s · ${labelOf(beat.code)}] ${beat.quote!.trim()}`).join("\n")),
    adCount: ads.length,
  };
}

const CONCEPT_FIT: Record<string, string> = {
  "New way vs old way": "Angles where the customer is stuck with an outdated fix (sleeves, socks, creams) and the product is the modern replacement.",
  "How it works": "Mechanism-led angles where understanding why it works is the persuasion.",
  "Hidden cause": "Angles built on a reframe: the real reason is something nobody told them.",
  "Transformation": "Desire-led angles where the after-state is vivid and worth showing.",
  "Tried everything": "Skeptical, last-resort audiences who have been let down before.",
};

/**
 * Every format the corpus can support today: one per big idea (concept) and one per
 * opening hook, for cohorts of WINNER_FORMAT_MIN_ADS or more.
 */
export function deriveWinnerFormats(ads: WinnerFormatAd[], taxonomyEntries: WinnerFormatTaxonomy[]): DerivedWinnerFormat[] {
  const taxonomy = new Map(taxonomyEntries.map((entry) => [entry.code, entry]));
  const out: DerivedWinnerFormat[] = [];
  const group = <K extends string>(keyOf: (ad: WinnerFormatAd) => K | null) => {
    const groups = new Map<K, WinnerFormatAd[]>();
    for (const ad of ads) { const key = keyOf(ad); if (key) groups.set(key, [...(groups.get(key) ?? []), ad]); }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  };
  for (const [concept, cohort] of group((ad) => ad.conceptTag && ad.conceptTag !== "Other" ? ad.conceptTag : null)) {
    const format = formatFrom({
      name: `Winners · ${concept}`, slug: `winners-${slugify(concept)}`, lens: `hang on the idea “${concept}”`,
      bestFor: CONCEPT_FIT[concept] ?? `Angles that suit the “${concept}” idea.`, ads: cohort, taxonomy,
    });
    if (format) out.push(format);
  }
  for (const [hook, cohort] of group((ad) => { const first = ordered(ad)[0]?.code; return first?.startsWith("H_") ? first : null; })) {
    const label = taxonomy.get(hook)?.label ?? hook;
    const format = formatFrom({
      name: `Winners · ${label} open`, slug: `winners-open-${slugify(label)}`, lens: `open with “${label}”`,
      bestFor: `Any angle where the strongest first three seconds is: ${(taxonomy.get(hook)?.description ?? label).replace(/\.$/, "")}.`, ads: cohort, taxonomy,
    });
    if (format) out.push(format);
  }
  return out;
}
