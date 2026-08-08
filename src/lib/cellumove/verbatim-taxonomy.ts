// Module 1 defaults — the Verbatim Classification Framework + Source Weighting
// Rules, encoded so the corpus works out of the box. A researcher-scoped SOP in
// /knowledge can refine or override these at runtime (the agent injects it on
// top of this baseline).

export interface VerbatimCategory {
  slug: string;
  label: string;
  description: string;
}

// ─── Classification taxonomy ─────────────────────────────────────────────────
export const VERBATIM_CATEGORIES: VerbatimCategory[] = [
  { slug: "primary_pain", label: "Primary pain", description: "The dominant, most-felt suffering — the thing they'd name first." },
  { slug: "secondary_pain", label: "Secondary pain", description: "Downstream or situational pains that compound the primary one." },
  { slug: "desire", label: "Desire", description: "The outcome / future-state they actually want." },
  { slug: "objection", label: "Objection", description: "Reasons not to buy / skepticism / past disappointment." },
  { slug: "false_belief", label: "False belief", description: "An incorrect assumption about the problem or the solution that blocks the sale." },
  { slug: "trigger_event", label: "Trigger event", description: "The concrete moment that pushes them to look for a fix ('couldn't fit into…', 'doctor said…')." },
  { slug: "vocabulary", label: "Vocabulary", description: "The exact words/phrases they use — for hooks and on-screen copy." },
  { slug: "perceived_mechanism", label: "Perceived mechanism", description: "How THEY think the problem works (often wrong, but it's their mental model)." },
];

export const VERBATIM_CATEGORY_SLUGS = VERBATIM_CATEGORIES.map((c) => c.slug);
export const VERBATIM_CATEGORY_BY_SLUG: Record<string, VerbatimCategory> = Object.fromEntries(
  VERBATIM_CATEGORIES.map((c) => [c.slug, c]),
);

// ─── Source weighting ────────────────────────────────────────────────────────
// Ranking per the Source Weighting Rules: long-form first-person threads carry
// the most signal; short reactive comments the least.
//   Long Reddit thread > forum long-form > Quora > Reddit comment >
//   Amazon review > Trustpilot > YouTube comment > TikTok comment.
export interface SourceType {
  slug: string;
  label: string;
  rank: number; // 0..1 base credibility weight
}

export const SOURCE_TYPES: SourceType[] = [
  { slug: "reddit_thread", label: "Reddit thread (long)", rank: 1.0 },
  { slug: "forum", label: "Forum / community (long-form)", rank: 0.9 },
  { slug: "quora", label: "Quora answer", rank: 0.85 },
  { slug: "reddit_comment", label: "Reddit comment", rank: 0.8 },
  { slug: "amazon_review", label: "Amazon review", rank: 0.75 },
  { slug: "trustpilot", label: "Trustpilot review", rank: 0.7 },
  { slug: "youtube_comment", label: "YouTube comment", rank: 0.6 },
  { slug: "tiktok_comment", label: "TikTok comment", rank: 0.4 },
  { slug: "other", label: "Other", rank: 0.3 },
];

export const SOURCE_TYPE_SLUGS = SOURCE_TYPES.map((s) => s.slug);
export const SOURCE_TYPE_BY_SLUG: Record<string, SourceType> = Object.fromEntries(
  SOURCE_TYPES.map((s) => [s.slug, s]),
);

// Combine source credibility with engagement. Engagement is dampened with a log
// so a 500-like comment outweighs a 5-like one without a 100× swing.
export function computeSourceWeight(sourceType: string, engagementScore: number): number {
  const rank = SOURCE_TYPE_BY_SLUG[sourceType]?.rank ?? 0.3;
  const eng = Math.max(0, engagementScore || 0);
  const engFactor = 1 + Math.log10(1 + eng); // 0 likes → 1×, 9 → 2×, 99 → 3×
  return Math.round(rank * engFactor * 1000) / 1000;
}

export function normalizeCategory(c: string): string {
  const s = (c || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return VERBATIM_CATEGORY_SLUGS.includes(s) ? s : "vocabulary";
}

export function normalizeSourceType(s: string): string {
  const v = (s || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return SOURCE_TYPE_SLUGS.includes(v) ? v : "other";
}
