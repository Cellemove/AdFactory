// CelluMove SHARED constants — single source of truth.
// Ported from cellumove-image-prompt-engine + cellumove-premortem skills.
// See CLAUDE.md §"Hard rules — never violate".

export const BANNED_WORDS = [
  "fix",
  "cure",
  "eliminate",
  "remove",
  "permanent",
  "permanently",
  "get rid of",
  "instant fix",
  "day 1 results",
  "guaranteed",
  "miracle",
  "magic",
  "100%",
  "doctor recommended",
  "medically proven",
  "clinically proven",
  "fda approved",
  "lose weight",
  "weight loss",
  "burn fat",
  "fat burning",
] as const;

// Words that get a WARN softening rather than a BLOCK.
export const SOFTEN_WORDS = [
  "best",
  "perfect",
  "transform",
  "transformation",
  "results",
] as const;

export const BANNED_VISUAL_PROPS = [
  "clock",
  "stopwatch",
  "timer",
  "hourglass",
  "calendar",
  "orange peel",
  "orange",
  "flame",
  "fire",
  "scale",
  "weighing scale",
  "tape measure",
  "measuring tape",
  "before/after photo grid",
  "side-by-side body comparison",
  "doctor in lab coat",
  "stethoscope",
  "pill",
  "syringe",
] as const;

export const BANNED_LEGGING_TEXTURES = [
  "honeycomb",
  "hexagon",
  "ribbed",
  "quilted",
  "printed",
  "mesh",
  "lace",
  "fishnet",
  "diamond pattern",
  "geometric pattern",
] as const;

export const BANNED_STYLING = [
  "skirt over leggings",
  "leggings as outerwear styled with",
  "thong over leggings",
  "swimsuit over leggings",
] as const;

export const BANNED_CASTING = [
  "black",
  "african",
  "afro-caribbean",
  "dark skin tone",
  "dark-skinned",
] as const;

export const ALLOWED_SKIN_TONES = [
  "Latina",
  "White",
  "Middle Eastern",
  "Asian",
] as const;

export const ALLOWED_CTAS = [
  "Shop Now",
  "Get 50% OFF",
  "BOGO Today",
  "Limited Stock",
  "Order Now",
] as const;

export const BANNED_CTAS = [
  "70% off",
  "70% OFF",
  "80% off",
  "90% off",
  "free shipping forever",
] as const;

export const TRUST_TEXT_BANK = [
  "Trusted by 100K+ women",
  "100% money-back guarantee",
  "Made for sensitive skin",
  "Designed by physiotherapists",
  "Free shipping over $50",
] as const;

// Canonical legging-reference language.
// The engine must use this EXACT string. Never invent texture.
export const LEGGING_REFERENCE = "the exact leggings from the reference image";

export const FUNNELS = ["TOFU", "MOFU", "BOFU"] as const;
export type Funnel = (typeof FUNNELS)[number];

export const LEVELS = ["easy", "medium", "hard"] as const;
export type Level = (typeof LEVELS)[number];

export const EDITORS = ["MO", "VA", "DO"] as const;
export type Editor = (typeof EDITORS)[number];

export const BANNED_EDITORS = ["SU"] as const;

// Transformation pattern: what the image should depict.
// Pre-state → mechanism cue → post-state. NEVER literal before/after grid.
export const TRANSFORMATION_PATTERN = {
  preState: "subtle discomfort cue (hand on calf, slight wince, end-of-day fatigue posture)",
  mechanismCue: "non-literal visual representing the mechanism (varies per angle)",
  postState: "confidence cue (relaxed posture, mid-stride, calm expression)",
} as const;

// Batch composition guidance — how a 25-prompt batch should distribute levels.
export const BATCH_COMPOSITION = {
  easy: 0.4,   // 10/25
  medium: 0.4, // 10/25
  hard: 0.2,   // 5/25
} as const;

export const DISCOUNT_CAP = 50; // percent

export const TOOL_ROUTING = {
  nano_banana_pro: "Default. Use for photoreal lifestyle, on-model product, transformation cue scenes.",
  higgsfield: "Use for stylized typographic posters and graphic-heavy hooks where Nano underdelivers on text.",
} as const;
