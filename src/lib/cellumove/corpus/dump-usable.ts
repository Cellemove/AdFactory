// Sorts deconstructed ads for the bulk download: which ones are worth reading.
// A brand's winners include other products and many re-cuts of one script (new
// hook, same body), so "93 ads" was really 40 distinct leggings scripts.

export type DeconstructedAd = { id: string; winnerScore: number | null; product: string; spoken: string };
export type UsableFolder = "unique" | "recuts" | "other-products";
export type UsableVerdict = { folder: UsableFolder; duplicateOf: string | null; spokenWords: number };

// ponytail: keyword match on Teardown's "Ad Name/Product" + category (always
// written in English). Add a per-project product setting if AdFactory ever
// serves a second product line.
const ON_PRODUCT = /legging|cellulite|shapewear|lymphatic|sculpt/i;
const SHINGLE = 5;
const RECUT_OVERLAP = 0.5;
const MIN_WORDS = 40; // under this there is no script to compare (music-only, text-only)

function shingles(words: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

/** Best-scoring ad of each script stays in unique/; the rest point at it. */
export function sortDeconstructedAds(ads: DeconstructedAd[]): Map<string, UsableVerdict> {
  const verdicts = new Map<string, UsableVerdict>();
  const kept: Array<{ id: string; shingles: Set<string> }> = [];
  // ponytail: O(n²) set overlap, ~0.1s at 200 ads; MinHash if it reaches thousands.
  for (const ad of [...ads].sort((a, b) => (b.winnerScore ?? 0) - (a.winnerScore ?? 0))) {
    const words = ad.spoken.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const verdict: UsableVerdict = { folder: "unique", duplicateOf: null, spokenWords: words.length };
    verdicts.set(ad.id, verdict);
    if (!ON_PRODUCT.test(ad.product)) { verdict.folder = "other-products"; continue; }
    if (words.length < MIN_WORDS) continue;
    const mine = shingles(words);
    const twin = kept.find((other) => {
      let shared = 0;
      for (const item of mine) if (other.shingles.has(item)) shared += 1;
      return shared / Math.min(mine.size, other.shingles.size) >= RECUT_OVERLAP;
    });
    if (twin) { verdict.folder = "recuts"; verdict.duplicateOf = twin.id; } else kept.push({ id: ad.id, shingles: mine });
  }
  return verdicts;
}
