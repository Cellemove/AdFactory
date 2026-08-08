// 12 Big-Swing formats + 12 hook mechanics, ported from cellumove-visual-hooks /
// cellumove-iteration-factory skills.

export type BigSwingFormat =
  | "split_panel"
  | "typographic_poster"
  | "product_explosion"
  | "before_after_subtle"
  | "infographic_card"
  | "testimonial_card"
  | "ugc_screenshot"
  | "founder_letter"
  | "ingredient_breakdown"
  | "comparison_table"
  | "before_during_after_strip"
  | "headline_only_block";

export interface FormatSpec {
  slug: BigSwingFormat;
  name: string;
  description: string;
  funnelFit: Array<"TOFU" | "MOFU" | "BOFU">;
  visualSpec: string;
  defaultHookOptions: string[];
}

export const BIG_SWING_FORMATS: FormatSpec[] = [
  {
    slug: "split_panel",
    name: "Split Panel",
    description: "Two visually contrasting halves separated by a clean vertical or diagonal seam.",
    funnelFit: ["TOFU", "MOFU"],
    visualSpec:
      "16:9 or 4:5 split; left = pain-state cue, right = relief-state cue. Mechanism implied, never literal.",
    defaultHookOptions: ["Before the day even ends.", "One swap, one shift.", "Same legs. New rhythm."],
  },
  {
    slug: "typographic_poster",
    name: "Typographic Poster",
    description: "Headline-dominant layout, minimal photography, strong type hierarchy.",
    funnelFit: ["TOFU", "BOFU"],
    visualSpec:
      "Headline 60-75% of canvas. Pink (or black, per angle) background. Product cropped at edge as accent. NO named font.",
    defaultHookOptions: ["This is your sign.", "Stop scrolling.", "We need to talk about your legs."],
  },
  {
    slug: "product_explosion",
    name: "Product Explosion",
    description: "Hero shot of leggings with floating mechanism callouts.",
    funnelFit: ["MOFU", "BOFU"],
    visualSpec:
      "Centered leggings (literal reference string), 3-4 thin callout lines pointing to mechanism zones.",
    defaultHookOptions: ["Built for your legs.", "Engineered for end-of-day.", "Not just leggings."],
  },
  {
    slug: "before_after_subtle",
    name: "Subtle Before/After",
    description: "Two states of the SAME woman, same pose, mood shift only. Never body-comparison.",
    funnelFit: ["MOFU"],
    visualSpec:
      "Two frames, same model, same outfit, same pose. Difference is mood / posture / facial expression. No measurement overlay.",
    defaultHookOptions: ["6pm vs 9pm.", "Same Tuesday. New Tuesday."],
  },
  {
    slug: "infographic_card",
    name: "Infographic Card",
    description: "Clean diagrammatic explanation of the mechanism.",
    funnelFit: ["MOFU"],
    visualSpec:
      "Card layout, 3 numbered steps. Iconography is abstract — never a clock, calendar, or orange.",
    defaultHookOptions: ["How it actually works.", "Three things happening right now."],
  },
  {
    slug: "testimonial_card",
    name: "Testimonial Card",
    description: "Customer voice as the hero, restrained product presence.",
    funnelFit: ["MOFU", "BOFU"],
    visualSpec:
      "Quote in large type, attribution underneath. Small product still life lower-right. No staged smiling-doctor photo.",
    defaultHookOptions: ["I didn't believe it either.", "Three weeks in.", "Bought a second pair."],
  },
  {
    slug: "ugc_screenshot",
    name: "UGC Screenshot",
    description: "Looks like a phone screenshot — text-message, IG comment, or DM aesthetic.",
    funnelFit: ["TOFU", "MOFU"],
    visualSpec:
      "Faux-screenshot framing. Time/status bar at top. Bubbles or comment thread layout. No real brand logos.",
    defaultHookOptions: ["my coworker just asked.", "ok i finally tried them.", "this is unhinged but"],
  },
  {
    slug: "founder_letter",
    name: "Founder Letter",
    description: "Personal-letter framing, signature at the bottom.",
    funnelFit: ["MOFU"],
    visualSpec:
      "Off-white paper texture. Letter-style margins. Handwritten-style signature (described, not named font).",
    defaultHookOptions: ["A note from us.", "We almost didn't make these."],
  },
  {
    slug: "ingredient_breakdown",
    name: "Ingredient Breakdown",
    description: "Materials / tech breakdown, fabric story.",
    funnelFit: ["BOFU"],
    visualSpec:
      "Fabric swatch close-up + 3 labeled callouts. No medical claims. No 'clinically proven'.",
    defaultHookOptions: ["What's actually in there.", "The fabric does the work."],
  },
  {
    slug: "comparison_table",
    name: "Comparison Table",
    description: "Us-vs-them table; competitor stays unnamed/abstract.",
    funnelFit: ["BOFU"],
    visualSpec:
      "Two-column table, checks vs dashes. Competitor labeled 'other leggings', never named brand.",
    defaultHookOptions: ["Why we replaced ours.", "Pay attention to row 3."],
  },
  {
    slug: "before_during_after_strip",
    name: "Before / During / After Strip",
    description: "Three-frame strip — pre-state, mechanism cue, confidence cue.",
    funnelFit: ["MOFU"],
    visualSpec:
      "Three equal panels, same model, mechanism cue panel is abstract not literal.",
    defaultHookOptions: ["7am. 1pm. 8pm.", "Quiet upgrade."],
  },
  {
    slug: "headline_only_block",
    name: "Headline-Only Block",
    description: "No imagery — type and a single mark.",
    funnelFit: ["TOFU"],
    visualSpec:
      "Solid color field, headline only, small product silhouette or wordmark in corner.",
    defaultHookOptions: ["Read this twice.", "If you stand all day."],
  },
];

export const BIG_SWING_FORMAT_BY_SLUG: Record<BigSwingFormat, FormatSpec> =
  Object.fromEntries(BIG_SWING_FORMATS.map((f) => [f.slug, f])) as Record<
    BigSwingFormat,
    FormatSpec
  >;

export type HookMechanic =
  | "pattern_interrupt"
  | "callout"
  | "negative_promise"
  | "specific_number"
  | "social_proof_drop"
  | "stat_shock"
  | "rhetorical_question"
  | "us_vs_them"
  | "founder_confession"
  | "story_open_loop"
  | "permission_slip"
  | "list_promise";

export interface HookSpec {
  slug: HookMechanic;
  name: string;
  description: string;
  example: string;
}

export const HOOK_MECHANICS: HookSpec[] = [
  { slug: "pattern_interrupt", name: "Pattern Interrupt", description: "Breaks scroll rhythm with unexpected framing.", example: "We need to talk about your legs." },
  { slug: "callout", name: "Callout", description: "Targets a specific persona to claim attention.", example: "For women who stand all day —" },
  { slug: "negative_promise", name: "Negative Promise", description: "States what the product won't do, to earn trust.", example: "These won't make you skinnier." },
  { slug: "specific_number", name: "Specific Number", description: "Concrete numeric anchor (no exaggerated stats).", example: "After 3 weeks of wearing them daily…" },
  { slug: "social_proof_drop", name: "Social Proof Drop", description: "Names a real-feeling situation that implies adoption.", example: "My pilates instructor asked." },
  { slug: "stat_shock", name: "Stat Shock", description: "Surprising domain stat (must be defensible).", example: "67% of women over 30 experience heavy legs by 6pm." },
  { slug: "rhetorical_question", name: "Rhetorical Question", description: "Question whose answer the reader already feels.", example: "Why do your legs feel heavier at 6pm than at 8am?" },
  { slug: "us_vs_them", name: "Us vs Them", description: "Explicit positioning against vague competitor.", example: "Other leggings squeeze. These support." },
  { slug: "founder_confession", name: "Founder Confession", description: "Personal admission as the hook.", example: "I almost didn't ship these." },
  { slug: "story_open_loop", name: "Story Open Loop", description: "Opens a story without resolving it on the canvas.", example: "She showed up to my class in a different mood —" },
  { slug: "permission_slip", name: "Permission Slip", description: "Gives the reader permission to want the outcome.", example: "It is OK to want lighter legs." },
  { slug: "list_promise", name: "List Promise", description: "Promises a list the headline implies but doesn't deliver.", example: "Three things your leggings should never do." },
];

export const HOOK_BY_SLUG: Record<HookMechanic, HookSpec> = Object.fromEntries(
  HOOK_MECHANICS.map((h) => [h.slug, h]),
) as Record<HookMechanic, HookSpec>;
