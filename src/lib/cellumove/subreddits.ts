// The research subreddit list — one place every research call draws from.
//
// Reddit is the highest-signal verbatim source for this brand. Rather than
// scatter sub names across prompts, we keep them here, grouped into themed
// clusters and matched to an angle by keyword. research.ts injects the relevant
// subs into each prompt AND passes them to gatherRedditVerbatims.
//
// These are SEED communities — high-signal starting points, NOT a boundary. The
// verbatim fetcher searches all of Reddit first and only ADDITIONALLY digs into
// these subs, and the prompt block tells the model to follow the conversation into
// any other relevant subreddit it discovers. Curated list, open scope.
//
// Slugs are what follows "r/". Reddit search is case-insensitive, but we keep the
// communities' canonical casing for display.

export interface SubredditCluster {
  key: string;
  // lowercase substrings matched against an angle's slug/name/mechanism/keyword/focus
  keywords: string[];
  subs: string[];
}

// Every slug below was existence-checked (real, correctly-cased) before landing
// here — unconfirmed ones stay in UNVERIFIED_SUBREDDIT_CANDIDATES instead. Within a
// cluster, subs are ordered strongest-first: the per-angle picker is capped, so the
// most on-brand community should come first.
export const SUBREDDIT_CLUSTERS: SubredditCluster[] = [
  {
    key: "postpartum",
    keywords: ["postpartum", "post-partum", "post partum", "pregnan", "baby", "mom", "mum", "maternity", "nursing", "breastfeed", "c-section", "csection", "diastasis", "pelvic floor", "prolapse", "fourth trimester"],
    subs: ["diastasisrecti", "pelvicfloor", "beyondthebump", "Mommit", "BabyBumps", "NewParents", "fitpregnancy", "breastfeeding", "postpartumprogress", "pregnant", "workingmoms"],
  },
  {
    key: "lipedema",
    keywords: ["lipedema", "lipoedema", "lymphedema", "lymphoedema", "lymph", "fluid retention", "fibro", "connective tissue", "chronic illness"],
    subs: ["lipedema", "lipoedema", "lymphedema", "Compression", "ChronicIllness", "Fibromyalgia", "ehlersdanlos", "POTS"],
  },
  {
    key: "legs_venous",
    keywords: ["vein", "venous", "varicose", "spider vein", "phleb", "swollen", "swelling", "heavy leg", "tired leg", "achy leg", "circulation", "restless", "edema", "oedema"],
    subs: ["varicoseveins", "veins", "Compression", "RestlessLegs", "lymphedema", "ChronicPain"],
  },
  {
    key: "joint",
    keywords: ["knee", "joint", "arthrit", "osteo", "cartilage", "mobility", "sciatica", "rheumat", "hip", "tendon"],
    subs: ["Arthritis", "osteoarthritis", "rheumatoid", "KneesOverToes", "Sciatica", "ChronicPain"],
  },
  {
    key: "body_weight",
    keywords: ["pcos", "weight", "cellulite", "menopause", "perimenopause", "hormone", "slim", "tone", "fat", "fasting", "cico", "bloat"],
    subs: ["PCOS", "Menopause", "Perimenopause", "loseit", "CICO", "intermittentfasting", "xxfitness", "cellulite"],
  },
  {
    key: "fashion_shape",
    keywords: ["shapewear", "shaping", "silhouette", "hourglass", "legging", "fashion", "outfit", "dress", "plus size", "plus-size", "jeans", "wardrobe", "curvy", "petite"],
    subs: ["PlusSize", "PlusSizeFashion", "curvy", "femalefashionadvice", "FashionPlus", "PetiteFashion", "Outfits"],
  },
];

// Always-relevant for this DTC women's-body brand, regardless of angle.
export const BASE_SUBREDDITS = ["TwoXChromosomes"];

// Every subreddit we research, deduped — "our list".
export const ALL_RESEARCH_SUBREDDITS: string[] = [
  ...new Set([...SUBREDDIT_CLUSTERS.flatMap((c) => c.subs), ...BASE_SUBREDDITS]),
];

// Candidate communities we could NOT confirm on the stats mirror (404 there — the
// slug may still exist if the sub is very new or tiny). Kept out of the active
// clusters so a dead slug never silently returns nothing. Verify directly on Reddit,
// then promote into a cluster above:
//   • compressionsocks  • shapewear  • xxpetite
// (cellulite, veins/varicoseveins, and Postpartum_Depression were confirmed and
//  promoted — the first two into clusters; Postpartum_Depression is verified-real but
//  left out on relevance, promote it if we lean into the PPD/mental-health angle.)
export const UNVERIFIED_SUBREDDIT_CANDIDATES = ["compressionsocks", "shapewear", "xxpetite"];

export interface AngleLike {
  slug?: string | null;
  name?: string | null;
  mechanism?: string | null;
  requiredKeyword?: string | null;
  focus?: string | null;
}

// Pick the subreddits relevant to an angle by keyword match. No match → cast wide
// (this brand spans all the clusters). Always unions the base set. Capped at `max`
// (one expanded cluster ≈ 11 subs, so 15 leaves headroom for a second matched cluster).
export function subredditsForAngle(input: AngleLike, max = 15): string[] {
  const hay = [input.slug, input.name, input.mechanism, input.requiredKeyword, input.focus]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matched = SUBREDDIT_CLUSTERS.filter((c) => c.keywords.some((k) => hay.includes(k)));
  const clusters = matched.length ? matched : SUBREDDIT_CLUSTERS;
  const subs = [...new Set([...clusters.flatMap((c) => c.subs), ...BASE_SUBREDDITS])];
  return subs.slice(0, max);
}

// Render a prompt block pointing the model at good seed communities — explicitly
// framed as starting points, not a boundary, so research isn't confined to them.
export function renderSubredditBlock(subs: string[]): string {
  if (!subs.length) return "";
  return [
    "",
    "SEED communities to START with (site:reddit.com/r/<sub>) — open full threads, quote the comments:",
    subs.map((s) => `  • r/${s}`).join("\n"),
    "These are starting points, NOT a boundary. Also search all of Reddit (site:reddit.com) and follow the",
    "discussion into ANY other relevant subreddit you discover — do not limit yourself to the list above.",
  ].join("\n");
}
