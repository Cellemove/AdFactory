// Ports cellumove-image-prompt-engine v4.0.
// Holds the 11 hard rules, the 9-section recipe, tool routing.
// Outputs a batch of structured image prompts ready for Nano Banana Pro / Higgsfield.

import { DEFAULT_MODEL, getLLM } from "../llm";
import { recordUsage } from "../usage";
import { resolveAngle, type AngleSlug, type RuntimeAngleSpec } from "./angles";
import {
  BIG_SWING_FORMAT_BY_SLUG,
  HOOK_BY_SLUG,
  type BigSwingFormat,
  type HookMechanic,
} from "./formats";
import {
  ALLOWED_CTAS,
  ALLOWED_SKIN_TONES,
  BANNED_CASTING,
  BANNED_CTAS,
  BANNED_LEGGING_TEXTURES,
  BANNED_VISUAL_PROPS,
  BANNED_WORDS,
  BATCH_COMPOSITION,
  DISCOUNT_CAP,
  LEGGING_REFERENCE,
  type Funnel,
  type Level,
} from "./constants";

export interface EnginePromptSection {
  // The 9-section structure each STATIC image prompt MUST follow.
  scene: string;
  subject: string;
  pose: string;
  wardrobe: string;
  composition: string;
  lighting: string;
  mood: string;
  textOverlay: string;       // headline rendered with line breaks ONLY
  ctaAndTrust: string;
}

// Video script structures — modeled on the CelluMove Video Ad Scripts PDF.
// Each VIDEO prompt is one "iteration" (e.g. "The clothes I stopped wearing")
// with hook variants, a production format, and a 6-beat storyboard.
export interface VideoScriptBeat {
  beat: string;          // "HOOK" | "AFTER-HOOK" | "BODY 1" | "BODY 2" | "BODY 3" | "CTA"
  subtitle?: string;     // e.g. "shame", "desire", "angle mechanism", "transformation"
  time: string;          // e.g. "0–3s"
  visual: string;
  onScreenText: string;
  voiceover?: string;
  sfx?: string;
  bgm?: string;
}

export interface VideoScript {
  title: string;
  productionFormat: string; // "Direct-to-camera confessional", "VO + b-roll demo", etc.
  lengthSec: number;        // 30 = ~30 seconds
  avatarSegment: string;    // e.g. "Rachel — quiet shame"
  angle: string;            // one-line angle/positioning
  patternBreak: string;     // why this iteration differs from the others in the batch
  hooks: string[];          // 2-3 hook variants to A/B test
  beats: VideoScriptBeat[]; // 6 beats minimum: HOOK / AFTER-HOOK / BODY 1 / BODY 2 / BODY 3 / CTA
}

export type AdType = "static" | "video";

export interface GeneratedPrompt {
  index: number;
  tool: "nano_banana_pro" | "higgsfield" | "video_script";
  level: Level;
  hook: string;
  headlineRendered: string;
  sections: EnginePromptSection; // for video, this is a placeholder; the real payload is videoScript
  videoScript?: VideoScript;
  promptText: string;
}

export interface EngineInput {
  angleSlug: AngleSlug | string;
  // Optional override for user-created angles not in the hardcoded ANGLE_BY_SLUG.
  // When set, takes precedence over the slug lookup.
  angleSpec?: RuntimeAngleSpec | null;
  // Sub-avatar + research are optional. When omitted the engine targets a
  // generic angle-level audience and the prompts page warns the user.
  subAvatarName?: string | null;
  subAvatarShortDesc?: string | null;
  research?: {
    painPoints: string;
    desires: string;
    objections: string;
    dailyLanguage: string;
    triggers: string;
    identity: string;
    socialProof: string;
    buyingContext: string;
  } | null;
  // "static" = current 9-section image prompts. "video" = the PDF video-script format.
  adType?: AdType;
  // "iterate" = exploit a winner. "big_swing" = pick from the format library.
  // "ai_research" = engine grounds in live web search to find what's currently
  // working for the angle/audience, then generates from those findings.
  lane: "iterate" | "big_swing" | "ai_research";
  conceptResearchFocus?: string | null;
  funnel: Funnel;
  // When any of these are omitted, the engine invents them per-prompt based on
  // the angle, research, and lane context.
  hook?: string | null;
  exactHeadline?: string | null;
  visualConcept?: string | null;
  targetCount: number;
  // Iterate lane
  parent?: {
    adName: string;
    headline: string;
    visualConcept: string;
    funnel: Funnel;
    hookType: string | null;
    performanceSummary?: string | null; // blended KPIs of the winner (if entered)
  };
  iterationVar?: string;
  hypothesis?: string;
  // Big-Swing lane
  bigSwingFormat?: BigSwingFormat;
  hookMechanic?: HookMechanic;
}

// ─── System prompt — the 11 hard rules + 9-section recipe + tool routing ─────
export function buildSystemPrompt(): string {
  return [
    "You are the CelluMove Image Prompt Engine v4.0.",
    "Your output is a JSON object that conforms exactly to the schema described below.",
    "You produce IMAGE-GENERATION PROMPTS only — never copywriting, never headlines.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "11 HARD RULES — NEVER VIOLATE. Each is auto-checked downstream; violations are rejected.",
    "════════════════════════════════════════════════════════════════════════",
    "1.  HEADLINE HANDLING.",
    "    If the brief provides `exactHeadline`, render it VERBATIM into textOverlay — only insert line breaks (`\\n`).",
    "    If the brief OMITS `exactHeadline`, compose a fresh headline per prompt that fits the angle's mechanism, the sub-avatar's pain/desire, and the lane (iterate or big swing). Vary headlines across the batch.",
    "2.  MECHANISM IMAGERY MATCHES THE ANGLE.",
    "    Anti-Cellulite → dimpling / surface micro-texture.",
    "    Lipoedema → lymphatic drainage flow.",
    "    Varicose Veins → venous valve / vein support.",
    "    Heavy Legs → venous return / end-of-day decompression.",
    "    Cross-contamination is auto-rejection.",
    "3.  SILHOUETTE + COLORWAY MATCH THE ANGLE.",
    "    Varicose Veins = full-length + black.",
    "    All others = short-legging + pink.",
    "    Promo inherits the parent angle's silhouette + colorway.",
    `4.  WARDROBE — LEGGING REFERENCE ONLY, NEVER DESCRIBE THE PRODUCT.`,
    `    For the legging itself, the wardrobe section MUST use ONLY the literal string: "${LEGGING_REFERENCE}".`,
    `    NEVER append qualifiers describing the product — no color ("pink", "black"), no silhouette ("short-legging", "full-length", "capri", "ankle-length"), no fabric ("nylon", "spandex", "compression"), no fit, no texture, no pattern.`,
    `    BANNED phrasings include (non-exhaustive): "...which are pink short-leggings", "...in black", "...with compression fabric", "...the pink leggings", "...the black leggings", etc.`,
    `    Only NON-legging wardrobe items (top, shoes, accessories) may be described normally.`,
    `    Banned textures elsewhere in the prompt: ${BANNED_LEGGING_TEXTURES.join(", ")}.`,
    `5.  NO BANNED CASTING. Banned: ${BANNED_CASTING.join(", ")}.`,
    `    Allowed skin tones only: ${ALLOWED_SKIN_TONES.join(", ")}.`,
    `6.  NO LITERAL HOOK RESTATEMENT. Banned props: ${BANNED_VISUAL_PROPS.join(", ")}.`,
    `    No clocks for time hooks. No oranges for orange peel. No flames for calories. No calendars.`,
    `7.  NO CURE LANGUAGE. Banned words: ${BANNED_WORDS.join(", ")}.`,
    `8.  DISCOUNT CAP ${DISCOUNT_CAP}% OFF OR BOGO. Never higher. Banned CTAs: ${BANNED_CTAS.join(", ")}.`,
    `    Allowed CTA strings: ${ALLOWED_CTAS.join(" | ")}.`,
    "9.  NO NAMED FONTS. Describe text visually (weight, case, scale) — no Helvetica/Inter/etc.",
    "10. NO 'SU' AS ITERATION EDITOR. SU is reserved. Editors are MO, VA, DO.",
    "11. ITERATION NAMING uses ONLY: IT[N]-[LEVEL]-[EDITOR]-[ORIGINAL_AD_NAME]-[HOOK].",
    "    The legacy `IT1-Singing-Cellulitis-easy-...` format is deprecated and must never be emitted.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "9-SECTION RECIPE — every prompt must include all 9 sections, in this order:",
    "════════════════════════════════════════════════════════════════════════",
    "  1. scene          — environment + framing",
    "  2. subject        — model description (skin tone from allowed list only)",
    "  3. pose           — body posture, gesture",
    "  4. wardrobe       — must reference the legging-reference string verbatim",
    "  5. composition    — shot type, focal length feel, crop",
    "  6. lighting       — direction, quality, mood",
    "  7. mood           — emotional read",
    "  8. textOverlay    — exactHeadline VERBATIM with \\n breaks only",
    "  9. ctaAndTrust    — CTA from allowed list + trust microcopy if applicable",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "TOOL ROUTING",
    "════════════════════════════════════════════════════════════════════════",
    "  - nano_banana_pro (default): photoreal lifestyle, on-model product, transformation cue scenes.",
    "  - higgsfield: stylized typographic posters and graphic-heavy hooks where Nano underdelivers on text.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "BATCH COMPOSITION GUIDANCE",
    "════════════════════════════════════════════════════════════════════════",
    `  Distribute levels approximately: ${Math.round(BATCH_COMPOSITION.easy * 100)}% easy, ${Math.round(BATCH_COMPOSITION.medium * 100)}% medium, ${Math.round(BATCH_COMPOSITION.hard * 100)}% hard.`,
    "  easy = clean lifestyle, single mechanism cue, BAU. medium = added layout tension or hook mechanic.",
    "  hard = format swing or unusual composition.",
    "",
    "OUTPUT SCHEMA (JSON only — no prose, no markdown):",
    "{",
    '  "prompts": [',
    "    {",
    '      "index": 1,',
    '      "tool": "nano_banana_pro" | "higgsfield",',
    '      "level": "easy" | "medium" | "hard",',
    '      "hook": "<short string>",',
    '      "headlineRendered": "<exactHeadline with \\n breaks only>",',
    '      "sections": {',
    '        "scene": "...", "subject": "...", "pose": "...", "wardrobe": "...",',
    '        "composition": "...", "lighting": "...", "mood": "...",',
    '        "textOverlay": "...", "ctaAndTrust": "..."',
    "      }",
    "    }",
    "  ]",
    "}",
    "",
    "Return ONLY the JSON object. No prose. No code fences.",
  ].join("\n");
}

export function buildUserPrompt(input: EngineInput): string {
  const angle = resolveAngle(input.angleSlug, input.angleSpec);
  if (!angle) throw new Error(`Unknown angle: ${input.angleSlug}`);
  const fmt = input.bigSwingFormat ? BIG_SWING_FORMAT_BY_SLUG[input.bigSwingFormat] : null;
  const hookMech = input.hookMechanic ? HOOK_BY_SLUG[input.hookMechanic] : null;

  const lines: string[] = [];
  lines.push(`ANGLE: ${angle.name} (${angle.slug})`);
  lines.push(`  Required keyword: ${angle.requiredKeyword || "(promo — inherits)"}`);
  lines.push(`  Mechanism to show: ${angle.mechanism}`);
  lines.push(`  Mechanisms BANNED here: ${angle.bannedMechanism}`);
  lines.push(`  Silhouette: ${angle.silhouette}`);
  lines.push(`  Colorway: ${angle.colorway}`);
  lines.push("");
  if (input.subAvatarName) {
    lines.push(`SUB-AVATAR: ${input.subAvatarName}`);
    if (input.subAvatarShortDesc) lines.push(`  ${input.subAvatarShortDesc}`);
    lines.push("");
  } else {
    lines.push("SUB-AVATAR: (skipped — target the generic angle-level audience)");
    lines.push("");
  }
  if (input.research) {
    lines.push("RESEARCH:");
    lines.push(`  Pain points: ${input.research.painPoints}`);
    lines.push(`  Desires: ${input.research.desires}`);
    lines.push(`  Objections: ${input.research.objections}`);
    lines.push(`  Daily language: ${input.research.dailyLanguage}`);
    lines.push(`  Triggers: ${input.research.triggers}`);
    lines.push(`  Identity: ${input.research.identity}`);
    lines.push(`  Social proof: ${input.research.socialProof}`);
    lines.push(`  Buying context: ${input.research.buyingContext}`);
    lines.push("");
  } else {
    lines.push("RESEARCH: (none — rely on the angle's mechanism and the brief's hook/visual concept).");
    lines.push("");
  }
  lines.push(`LANE: ${input.lane}`);
  lines.push(`FUNNEL: ${input.funnel}`);
  if (input.hook) {
    lines.push(`HOOK: ${input.hook}`);
  } else {
    lines.push("HOOK: (compose a fresh hook per prompt — vary the spike across the batch)");
  }
  if (input.exactHeadline) {
    lines.push(`EXACT HEADLINE (verbatim — never rewrite): ${JSON.stringify(input.exactHeadline)}`);
  } else {
    lines.push("HEADLINE: (compose per prompt — fit the angle, sub-avatar, lane; vary across the batch)");
  }
  if (input.visualConcept) {
    lines.push(`VISUAL CONCEPT: ${input.visualConcept}`);
  } else {
    lines.push("VISUAL CONCEPT: (invent per prompt — each should depict a distinct scene that lands the mechanism cue)");
  }
  lines.push(`TARGET COUNT: ${input.targetCount}`);
  lines.push("");

  if (input.lane === "iterate" && input.parent) {
    lines.push("ITERATION CONTEXT:");
    lines.push(`  Parent winner ad: ${input.parent.adName}`);
    lines.push(`  Parent headline: ${input.parent.headline}`);
    lines.push(`  Parent visual: ${input.parent.visualConcept}`);
    lines.push(`  Parent funnel: ${input.parent.funnel}`);
    if (input.parent.hookType) lines.push(`  Parent hook type: ${input.parent.hookType}`);
    if (input.parent.performanceSummary) {
      lines.push(`  Parent performance (real KPIs): ${input.parent.performanceSummary}`);
      lines.push("  Treat these KPIs as ground truth. Preserve whatever is driving the winner's results and change only the test variable: strong ROAS ⇒ keep the offer/mechanism; strong CTR ⇒ keep the hook; a weak metric is the thing to improve.");
    }
    if (input.iterationVar) lines.push(`  Variable being changed (ONE only): ${input.iterationVar}`);
    if (input.hypothesis) lines.push(`  Hypothesis: ${input.hypothesis}`);
    lines.push("  Hold every other variable constant. Discipline: one variable per iteration.");
    lines.push("");
  }

  if (input.lane === "big_swing" && fmt) {
    lines.push("BIG-SWING CONTEXT:");
    lines.push(`  Format: ${fmt.name} (${fmt.slug})`);
    lines.push(`  Format spec: ${fmt.visualSpec}`);
    if (hookMech) {
      lines.push(`  Hook mechanic: ${hookMech.name} — ${hookMech.description}`);
      lines.push(`  Hook example: ${hookMech.example}`);
    }
    lines.push("");
  }

  if (input.lane === "ai_research") {
    lines.push("AI-RESEARCH LANE — grounded in live Google Search:");
    lines.push("  STEP 1: search the web for what is currently winning in DTC ads for this angle + audience.");
    lines.push("           Specifically look for: trending hook angles, headline patterns, visual concepts,");
    lines.push("           emotional entry points, and proof formats that are getting traction RIGHT NOW.");
    lines.push("           Use queries that include the angle slug, sub-avatar pain points, and current platforms");
    lines.push("           (TikTok, Instagram, Meta Ads Library, Facebook).");
    if (input.conceptResearchFocus) {
      lines.push(`  Research focus from the user: ${input.conceptResearchFocus}`);
    }
    lines.push("  STEP 2: synthesize your findings into a batch of prompts that adapt the winning patterns");
    lines.push("           you found to CelluMove specifically (angle mechanism, claims guardrails).");
    lines.push("  STEP 3: VARY the prompts across the patterns you found — do not produce N variants of one idea.");
    lines.push("  Citations from your search will be attached automatically; do not include URLs in the JSON.");
    lines.push("");
  }

  lines.push(`Produce a batch of ${input.targetCount} prompts.`);
  lines.push("Each prompt MUST follow the 9-section recipe and obey all 11 hard rules.");
  lines.push("Return ONLY the JSON object described in the system prompt. No markdown fences, no prose.");
  return lines.join("\n");
}

// Flatten a structured prompt to text for downstream tools that prefer plain prose.
export function flattenPromptText(p: Omit<GeneratedPrompt, "promptText">): string {
  const s = p.sections;
  return [
    `[Tool: ${p.tool}] [Level: ${p.level}] [Hook: ${p.hook}]`,
    `Scene: ${s.scene}`,
    `Subject: ${s.subject}`,
    `Pose: ${s.pose}`,
    `Wardrobe: ${s.wardrobe}`,
    `Composition: ${s.composition}`,
    `Lighting: ${s.lighting}`,
    `Mood: ${s.mood}`,
    `Text overlay (exact): ${s.textOverlay}`,
    `CTA & trust: ${s.ctaAndTrust}`,
  ].join("\n");
}

interface RawEngineResponse {
  prompts: Array<{
    index: number;
    tool: string;
    level: string;
    hook: string;
    headlineRendered: string;
    sections: EnginePromptSection;
  }>;
}

function extractJson(text: string): RawEngineResponse {
  // Anthropic occasionally wraps output in code fences despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]!.trim() : text.trim();
  return JSON.parse(body) as RawEngineResponse;
}

// ─── VIDEO SCRIPT ENGINE ─────────────────────────────────────────────────────
// Distinct system prompt for video scripts. Outputs follow the CelluMove Video
// Ad Scripts PDF format: hook variants + production format + 6-beat storyboard.

function buildVideoSystemPrompt(): string {
  return [
    "You are the CelluMove Video Ad Script Engine v1.0.",
    "Your output is a JSON object with a `scripts` array — each script is one ad iteration.",
    "You produce VIDEO AD SCRIPTS for paid social (Facebook/Instagram/TikTok), 9:16 vertical.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "MANDATORY STRUCTURE — every script must include all six beats in this order:",
    "════════════════════════════════════════════════════════════════════════",
    "  1. HOOK            — deepest desire/shame; the line that stops the scroll",
    "  2. AFTER-HOOK      — the emotional want underneath the hook",
    "  3. BODY 1          — how the problem actually works (the angle's mechanism)",
    "  4. BODY 2          — how the product solves it, effortlessly (the product's mechanism)",
    "  5. BODY 3          — transformation shown, never just told (real proof on screen)",
    "  6. CTA             — offer + call to action",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "PRODUCTION LADDER — each script picks ONE level:",
    "════════════════════════════════════════════════════════════════════════",
    "  - easy   : text-only image ad — no shoot, no actor, copy + still imagery only",
    "  - medium : one talking head + a few cutaways (direct-to-camera confessional, or VO + b-roll demo)",
    "  - hard   : crafted looping video OR full real UGC — multi-shot, beat-matched, full storyboard",
    "  Vary the levels across the batch so the account doesn't fatigue.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "HARD RULES — auto-rejected if violated:",
    "════════════════════════════════════════════════════════════════════════",
    "1.  MECHANISM MATCHES THE ANGLE.",
    "    Anti-Cellulite → graduated compression at the tissue layer where dimpling forms.",
    "    Lipoedema → lymphatic drainage flow.",
    "    Varicose Veins → venous valve / vein support.",
    "    Heavy Legs → venous return / end-of-day decompression.",
    "    Cross-contamination is auto-rejection.",
    "2.  NEVER DESCRIBE THE PRODUCT'S COLOR/SILHOUETTE/FABRIC in wardrobe copy.",
    "    Refer to the leggings as \"the leggings\" or \"Cellumove\" only — never \"pink short-leggings\", \"black compression\", etc.",
    "3.  DISCOUNT CAP 50% OFF OR BOGO. Never higher.",
    "4.  NO 'SU' AS EDITOR. SU is reserved. Editors are MO, VA, DO if mentioned.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "HOOK VARIANTS — each script must include 2-3 alternative opening hooks under `hooks`.",
    "════════════════════════════════════════════════════════════════════════",
    "  Each hook tests a DIFFERENT emotional entry (shame, financial regret, validation, curiosity, etc.).",
    "  Hooks should be specific and concrete (e.g. 'I haven't worn shorts in 4 years' beats 'I felt insecure').",
    "  The FIRST hook in the array is the primary hook used in the storyboard's HOOK beat.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "PATTERN-BREAK — every script in the batch must enter from a DIFFERENT emotion or format.",
    "════════════════════════════════════════════════════════════════════════",
    "  Avoid producing 4 variants of the same person. Use: avoidance, financial regret, satisfying visual test,",
    "  intimate confession, social validation, before/after proof, etc.",
    "",
    "════════════════════════════════════════════════════════════════════════",
    "OUTPUT SCHEMA (JSON only — no prose, no markdown fences):",
    "════════════════════════════════════════════════════════════════════════",
    "{",
    '  "scripts": [',
    "    {",
    '      "index": 1,',
    '      "title": "Short evocative title (e.g. \\"The clothes I stopped wearing\\")",',
    '      "level": "easy" | "medium" | "hard",',
    '      "productionFormat": "Format description (e.g. \\"Direct-to-camera confessional\\" or \\"Text-on-image montage — no shoot, no actor\\")",',
    '      "lengthSec": 30,',
    '      "avatarSegment": "1-line description of which avatar slice this targets",',
    '      "angle": "1-line strategic positioning (e.g. \\"Failed-solutions confession → mechanism teach → warm offer\\")",',
    '      "patternBreak": "1-line: why this iteration enters from a different emotion/format vs others in the batch",',
    '      "hooks": ["Hook A — primary opening line", "Hook B — alternative", "Hook C — alternative"],',
    '      "beats": [',
    '        {',
    '          "beat": "HOOK" | "AFTER-HOOK" | "BODY 1" | "BODY 2" | "BODY 3" | "CTA",',
    '          "subtitle": "1-2 word emotional label (optional)",',
    '          "time": "0–3s",',
    '          "visual": "Concrete visual description for the shot",',
    '          "onScreenText": "Text shown on screen during this beat",',
    '          "voiceover": "Spoken dialogue or VO (use empty string if silent)",',
    '          "sfx": "Sound effects (use empty string if none)",',
    '          "bgm": "Music direction (use empty string if none)"',
    '        }',
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Return ONLY the JSON object. No prose. No code fences.",
  ].join("\n");
}

function buildVideoUserPrompt(input: EngineInput): string {
  const angle = resolveAngle(input.angleSlug, input.angleSpec);
  if (!angle) throw new Error(`Unknown angle: ${input.angleSlug}`);
  const fmt = input.bigSwingFormat ? BIG_SWING_FORMAT_BY_SLUG[input.bigSwingFormat] : null;
  const hookMech = input.hookMechanic ? HOOK_BY_SLUG[input.hookMechanic] : null;

  const lines: string[] = [];
  lines.push(`ANGLE: ${angle.name} (${angle.slug})`);
  lines.push(`  Mechanism to teach in BODY 1: ${angle.mechanism}`);
  lines.push(`  Mechanisms BANNED here: ${angle.bannedMechanism}`);
  lines.push("");
  if (input.subAvatarName) {
    lines.push(`SUB-AVATAR: ${input.subAvatarName}`);
    if (input.subAvatarShortDesc) lines.push(`  ${input.subAvatarShortDesc}`);
    lines.push("");
  } else {
    lines.push("SUB-AVATAR: (skipped — target the generic angle-level audience)");
    lines.push("");
  }
  if (input.research) {
    lines.push("RESEARCH (use their actual phrasing in hooks and on-screen text):");
    lines.push(`  Pain points: ${input.research.painPoints}`);
    lines.push(`  Desires: ${input.research.desires}`);
    lines.push(`  Objections: ${input.research.objections}`);
    lines.push(`  Daily language: ${input.research.dailyLanguage}`);
    lines.push(`  Triggers: ${input.research.triggers}`);
    lines.push(`  Identity: ${input.research.identity}`);
    lines.push(`  Social proof: ${input.research.socialProof}`);
    lines.push(`  Buying context: ${input.research.buyingContext}`);
    lines.push("");
  } else {
    lines.push("RESEARCH: (none — rely on the angle's mechanism and the brief's hook alone).");
    lines.push("");
  }
  lines.push(`LANE: ${input.lane}`);
  lines.push(`FUNNEL: ${input.funnel}`);
  if (input.hook) lines.push(`PRIMARY HOOK SEED: ${input.hook}`);
  if (input.exactHeadline) lines.push(`EXACT TAGLINE (use verbatim somewhere if it fits): ${JSON.stringify(input.exactHeadline)}`);
  if (input.visualConcept) lines.push(`VISUAL CONCEPT NOTES: ${input.visualConcept}`);
  lines.push(`TARGET COUNT: ${input.targetCount} distinct iterations`);
  lines.push("");

  if (input.lane === "iterate" && input.parent) {
    lines.push("ITERATION CONTEXT — adapt this winning ad into video form:");
    lines.push(`  Parent winner ad: ${input.parent.adName}`);
    lines.push(`  Parent headline: ${input.parent.headline}`);
    lines.push(`  Parent visual: ${input.parent.visualConcept}`);
    lines.push(`  Parent funnel: ${input.parent.funnel}`);
    if (input.parent.hookType) lines.push(`  Parent hook type: ${input.parent.hookType}`);
    if (input.parent.performanceSummary) {
      lines.push(`  Parent performance (real KPIs): ${input.parent.performanceSummary}`);
      lines.push("  Treat these KPIs as ground truth. Preserve whatever is driving the winner's results and change only the test variable: strong ROAS ⇒ keep the offer/mechanism; strong CTR ⇒ keep the hook; a weak metric is the thing to improve.");
    }
    if (input.iterationVar) lines.push(`  Variable being changed (ONE only): ${input.iterationVar}`);
    if (input.hypothesis) lines.push(`  Hypothesis: ${input.hypothesis}`);
    lines.push("");
  }

  if (input.lane === "big_swing" && fmt) {
    lines.push("BIG-SWING CONTEXT:");
    lines.push(`  Format: ${fmt.name} (${fmt.slug})`);
    lines.push(`  Format spec: ${fmt.visualSpec}`);
    if (hookMech) {
      lines.push(`  Hook mechanic: ${hookMech.name} — ${hookMech.description}`);
      lines.push(`  Hook example: ${hookMech.example}`);
    }
    lines.push("");
  }

  if (input.lane === "ai_research") {
    lines.push("AI-RESEARCH LANE — grounded in live Google Search:");
    lines.push("  STEP 1: search the web for what is currently winning in DTC video ads for this angle + audience.");
    lines.push("           Specifically look for: trending hook angles, on-screen text patterns, production formats,");
    lines.push("           emotional entry points (shame / curiosity / validation / financial regret), and proof formats");
    lines.push("           that are getting traction RIGHT NOW on TikTok / Instagram Reels / Meta Ads Library.");
    if (input.conceptResearchFocus) {
      lines.push(`  Research focus from the user: ${input.conceptResearchFocus}`);
    }
    lines.push("  STEP 2: synthesize your findings into video iterations that adapt the winning patterns");
    lines.push("           to CelluMove specifically (angle mechanism, claims guardrails).");
    lines.push("  STEP 3: VARY the iterations across the patterns you found — different production levels (easy/medium/hard),");
    lines.push("           different emotional entries, different on-screen text styles.");
    lines.push("  Citations from your search will be attached automatically; do not include URLs in the JSON.");
    lines.push("");
  }

  lines.push(`Produce ${input.targetCount} distinct video-script iterations.`);
  lines.push("Each MUST have the 6 mandatory beats, 2-3 hook variants, and a distinct pattern-break vs the others.");
  lines.push("Vary the production level across the batch (mix easy / medium / hard).");
  lines.push("Return ONLY the JSON object described in the system prompt. No markdown fences, no prose.");
  return lines.join("\n");
}

function flattenVideoScript(script: VideoScript, idx: number, level: Level, hook: string): string {
  const lines: string[] = [];
  lines.push(`[Video script #${idx} · ${level}] "${script.title}"`);
  lines.push(`Production: ${script.productionFormat}`);
  if (script.lengthSec) lines.push(`Length: ~${script.lengthSec}s`);
  if (script.avatarSegment) lines.push(`Avatar segment: ${script.avatarSegment}`);
  if (script.angle) lines.push(`Angle: ${script.angle}`);
  if (script.patternBreak) lines.push(`Pattern-break: ${script.patternBreak}`);
  lines.push("");
  lines.push("HOOKS TO TEST:");
  script.hooks.forEach((h, i) => lines.push(`  ${String.fromCharCode(65 + i)} — ${h}`));
  lines.push("");
  lines.push("STORYBOARD:");
  for (const b of script.beats) {
    const head = b.subtitle ? `${b.beat} · ${b.subtitle}` : b.beat;
    lines.push(`  ${b.time} · ${head}`);
    lines.push(`    Visual:         ${b.visual}`);
    lines.push(`    On-screen text: ${b.onScreenText}`);
    if (b.voiceover) lines.push(`    Voiceover:      ${b.voiceover}`);
    if (b.sfx) lines.push(`    SFX:            ${b.sfx}`);
    if (b.bgm) lines.push(`    BGM:            ${b.bgm}`);
  }
  // hook param is used by the primary-hook reference; suppress unused warning
  void hook;
  return lines.join("\n");
}

interface RawVideoResponse {
  scripts: Array<{
    index: number;
    title: string;
    level: string;
    productionFormat?: string;
    lengthSec?: number;
    avatarSegment?: string;
    angle?: string;
    patternBreak?: string;
    hooks: string[];
    beats: VideoScriptBeat[];
  } & { level?: string }>;
}

async function runVideoScriptEngine(input: EngineInput): Promise<GeneratedPrompt[]> {
  const llm = getLLM();
  const system = buildVideoSystemPrompt();
  const user = buildVideoUserPrompt(input);

  // ai_research uses Google Search grounding. Same caveat as the static path:
  // Vertex disallows `tools` + `responseMimeType` together, so JSON mode is
  // dropped and we rely on the system prompt's strict JSON instruction.
  const grounded = input.lane === "ai_research";
  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      maxOutputTokens: 65536,
      ...(grounded
        ? { tools: [{ googleSearch: {} }] }
        : { responseMimeType: "application/json" }),
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "video_generation",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded,
    metadata: { angleSlug: input.angleSlug, lane: input.lane },
  });

  const text = resp.text;
  if (!text) throw new Error("Video script engine returned no text content");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const parsed = JSON.parse(body) as RawVideoResponse;
  if (!Array.isArray(parsed.scripts)) {
    throw new Error("Video engine response missing `scripts` array");
  }

  return parsed.scripts.map((s, i) => {
    const level: Level =
      s.level === "easy" || s.level === "medium" || s.level === "hard"
        ? (s.level as Level)
        : "medium";
    const primaryHook = s.hooks?.[0] ?? "";
    const script: VideoScript = {
      title: s.title ?? "",
      productionFormat: s.productionFormat ?? "",
      lengthSec: s.lengthSec ?? 0,
      avatarSegment: s.avatarSegment ?? "",
      angle: s.angle ?? "",
      patternBreak: s.patternBreak ?? "",
      hooks: Array.isArray(s.hooks) ? s.hooks : [],
      beats: Array.isArray(s.beats) ? s.beats : [],
    };
    const promptText = flattenVideoScript(script, s.index ?? i + 1, level, primaryHook);
    return {
      index: s.index ?? i + 1,
      tool: "video_script",
      level,
      hook: primaryHook,
      headlineRendered: script.title,
      // Empty placeholder sections so the type still satisfies. Real script is in videoScript.
      sections: { scene: "", subject: "", pose: "", wardrobe: "", composition: "", lighting: "", mood: "", textOverlay: primaryHook, ctaAndTrust: script.beats.find((b) => b.beat?.toUpperCase() === "CTA")?.onScreenText ?? "" },
      videoScript: script,
      promptText,
    };
  });
}

export async function runPromptEngine(input: EngineInput): Promise<GeneratedPrompt[]> {
  if (input.adType === "video") {
    return runVideoScriptEngine(input);
  }
  const llm = getLLM();
  const system = buildSystemPrompt();
  const user = buildUserPrompt(input);

  // ai_research uses Google Search grounding. Vertex disallows responseMimeType
  // alongside `tools`, so JSON mode is dropped here — the system prompt already
  // requires JSON-only output and extractJson tolerates the model's typical
  // fenced-code wrapping.
  const grounded = input.lane === "ai_research";
  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      maxOutputTokens: 65536,
      ...(grounded
        ? { tools: [{ googleSearch: {} }] }
        : { responseMimeType: "application/json" }),
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "generation",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded,
    metadata: { angleSlug: input.angleSlug, lane: input.lane },
  });

  const text = resp.text;
  if (!text) {
    throw new Error("Engine returned no text content");
  }
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.prompts)) {
    throw new Error("Engine response missing `prompts` array");
  }

  return parsed.prompts.map((p) => {
    const tool: GeneratedPrompt["tool"] =
      p.tool === "higgsfield" ? "higgsfield" : "nano_banana_pro";
    const level: Level =
      p.level === "easy" || p.level === "medium" || p.level === "hard"
        ? (p.level as Level)
        : "medium";
    const partial: Omit<GeneratedPrompt, "promptText"> = {
      index: p.index,
      tool,
      level,
      hook: p.hook,
      headlineRendered: p.headlineRendered,
      sections: p.sections,
    };
    return { ...partial, promptText: flattenPromptText(partial) };
  });
}
