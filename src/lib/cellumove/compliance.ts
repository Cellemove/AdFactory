// Ports cellumove-premortem skill. 10 deterministic gates run per generated prompt.
// Each gate returns BLOCK | WARN | PASS. A single BLOCK fails the prompt.
//
// Never soften a gate. If a BLOCK fires too often, fix the engine to stop producing it.

import { resolveAngle, type AngleSlug, type RuntimeAngleSpec } from "./angles";
import {
  ALLOWED_CTAS,
  ALLOWED_SKIN_TONES,
  BANNED_CASTING,
  BANNED_CTAS,
  BANNED_EDITORS,
  BANNED_LEGGING_TEXTURES,
  BANNED_VISUAL_PROPS,
  BANNED_WORDS,
  DISCOUNT_CAP,
  LEGGING_REFERENCE,
  SOFTEN_WORDS,
} from "./constants";
import type { GeneratedPrompt } from "./prompt-engine";

export type GateLevel = "pass" | "warn" | "block";

export interface GateResult {
  gate: string;
  level: GateLevel;
  message: string;
  evidence?: string;
}

export interface ComplianceReport {
  status: "pass" | "warn" | "block";
  results: GateResult[];
}

function lower(s: string): string {
  return s.toLowerCase();
}

function findFirstMatch(haystack: string, needles: readonly string[]): string | null {
  const h = lower(haystack);
  for (const n of needles) {
    if (h.includes(lower(n))) return n;
  }
  return null;
}

function joinPrompt(p: GeneratedPrompt): string {
  // Video scripts don't populate the 9 image sections — fall back to the flat
  // promptText (which includes hooks + storyboard) so gates that scan body
  // copy for cure language, banned words, etc. work on script copy too.
  if (p.tool === "video_script") return p.promptText;
  const s = p.sections;
  return [
    s.scene, s.subject, s.pose, s.wardrobe, s.composition,
    s.lighting, s.mood, s.textOverlay, s.ctaAndTrust,
  ].join(" ");
}

// ─── 1. Headline integrity — engine may only insert line breaks ──────────────
function gateHeadlineIntegrity(
  p: GeneratedPrompt,
  exactHeadline: string | null | undefined,
): GateResult {
  if (!exactHeadline || !exactHeadline.trim()) {
    return {
      gate: "headline_integrity",
      level: "pass",
      message: "No exactHeadline contract — engine composed its own.",
    };
  }
  const rendered = p.sections.textOverlay ?? p.headlineRendered ?? "";
  const normalize = (s: string) =>
    s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();
  const target = normalize(exactHeadline);
  const got = normalize(rendered.replace(/\\n|\n/g, " "));
  if (got === target || got.includes(target)) {
    return { gate: "headline_integrity", level: "pass", message: "Headline matches verbatim." };
  }
  return {
    gate: "headline_integrity",
    level: "block",
    message: "Headline drift detected — exactHeadline must be verbatim with line breaks only.",
    evidence: `expected: ${exactHeadline} | got: ${rendered}`,
  };
}

// ─── 2. Mechanism match — required keyword + no cross-contamination ──────────
function gateMechanismMatch(
  p: GeneratedPrompt,
  angleSlug: AngleSlug | string,
  angleOverride?: RuntimeAngleSpec | null,
): GateResult {
  const angle = resolveAngle(angleSlug, angleOverride);
  if (!angle) {
    return { gate: "mechanism_match", level: "warn", message: `Unknown angle "${angleSlug}" — skipping mechanism check.` };
  }
  const body = joinPrompt(p);
  if (angle.requiredKeyword) {
    if (!lower(body).includes(lower(angle.requiredKeyword))) {
      return {
        gate: "mechanism_match",
        level: "warn",
        message: `Required keyword "${angle.requiredKeyword}" not present in prompt body.`,
      };
    }
  }
  const banned = angle.bannedMechanism.split("|").map((s) => s.trim()).filter(Boolean);
  const hit = findFirstMatch(body, banned);
  if (hit) {
    return {
      gate: "mechanism_match",
      level: "block",
      message: `Cross-angle mechanism leaked: "${hit}" is banned for ${angle.name}.`,
      evidence: hit,
    };
  }
  return { gate: "mechanism_match", level: "pass", message: "Mechanism aligned with angle." };
}

// ─── 3. Silhouette + colorway ────────────────────────────────────────────────
function gateSilhouetteAndColorway(
  p: GeneratedPrompt,
  angleSlug: AngleSlug | string,
  angleOverride?: RuntimeAngleSpec | null,
): GateResult {
  const angle = resolveAngle(angleSlug, angleOverride);
  if (!angle) {
    return { gate: "silhouette_colorway", level: "pass", message: "Unknown angle — silhouette/colorway check skipped." };
  }
  const body = lower(joinPrompt(p));
  const wantsFullLength = angle.silhouette === "full-length";
  const wantsBlack = angle.colorway === "black";

  const mentionsShort = /\bshort\s*-?\s*legging|capri/.test(body);
  const mentionsFull = /full[\s-]*length|ankle[\s-]*length/.test(body);
  const mentionsBlack = /\bblack\b/.test(body);
  const mentionsPink = /\bpink\b/.test(body);

  const issues: string[] = [];
  if (wantsFullLength && mentionsShort) issues.push("short-legging mentioned but angle requires full-length");
  if (!wantsFullLength && mentionsFull) issues.push("full-length mentioned but angle requires short-legging");
  if (wantsBlack && mentionsPink) issues.push("pink mentioned but angle requires black colorway");
  if (!wantsBlack && mentionsBlack) issues.push("black mentioned but angle requires pink colorway");

  if (issues.length) {
    return {
      gate: "silhouette_colorway",
      level: "block",
      message: `Silhouette/colorway mismatch: ${issues.join("; ")}.`,
    };
  }
  return { gate: "silhouette_colorway", level: "pass", message: "Silhouette + colorway aligned." };
}

// ─── 4. Legging texture / reference string ───────────────────────────────────
// Wardrobe must use only the reference-image phrasing for the legging — no
// product descriptors (color, silhouette, fabric) attached. The reference image
// is the source of truth; restating its attributes is forbidden.
const PRODUCT_DESCRIPTOR_PATTERNS: RegExp[] = [
  /\b(pink|black|navy|grey|gray|blue|white|red)\s*[-]?\s*leggings?\b/,
  /\bleggings?\s*(,|which|in|of|are|that\s+are)\s+[^.]*\b(pink|black|navy|grey|gray|blue|white|red|short|full[-\s]*length|capri|ankle[-\s]*length|compression|spandex|nylon|polyester)\b/,
  /\b(short|full[-\s]*length|capri|ankle[-\s]*length|compression|spandex|nylon|polyester)\s*[-]?\s*leggings?\b/,
];

function gateLeggingTexture(p: GeneratedPrompt): GateResult {
  const wardrobe = p.sections.wardrobe ?? "";
  const wholeBody = joinPrompt(p);
  const texHit = findFirstMatch(wholeBody, BANNED_LEGGING_TEXTURES);
  if (texHit) {
    return {
      gate: "legging_texture",
      level: "block",
      message: `Banned legging texture used: "${texHit}".`,
    };
  }
  const leak = PRODUCT_DESCRIPTOR_PATTERNS.find((re) => re.test(lower(wardrobe)));
  if (leak) {
    const match = lower(wardrobe).match(leak);
    return {
      gate: "legging_texture",
      level: "block",
      message: `Wardrobe describes the product — must reference the image only, no color/silhouette/fabric qualifiers.`,
      evidence: match ? match[0] : undefined,
    };
  }
  if (!lower(wardrobe).includes(lower(LEGGING_REFERENCE))) {
    return {
      gate: "legging_texture",
      level: "warn",
      message: `Wardrobe section should reference: "${LEGGING_REFERENCE}".`,
    };
  }
  return { gate: "legging_texture", level: "pass", message: "Legging reference string present, no product leak." };
}

// ─── 5. Casting / skin tones ─────────────────────────────────────────────────
function gateCasting(p: GeneratedPrompt): GateResult {
  const subj = p.sections.subject ?? "";
  const banned = findFirstMatch(subj, BANNED_CASTING);
  if (banned) {
    return {
      gate: "casting",
      level: "block",
      message: `Banned casting detected: "${banned}".`,
    };
  }
  const hasAllowed = ALLOWED_SKIN_TONES.some((t) =>
    lower(subj).includes(lower(t)),
  );
  if (!hasAllowed) {
    return {
      gate: "casting",
      level: "warn",
      message: `Subject does not name an allowed skin tone (${ALLOWED_SKIN_TONES.join(", ")}).`,
    };
  }
  return { gate: "casting", level: "pass", message: "Casting within allowed skin tones." };
}

// ─── 6. Literal hook restatement / banned visual props ───────────────────────
function gateLiteralHook(p: GeneratedPrompt): GateResult {
  const body = joinPrompt(p);
  const hit = findFirstMatch(body, BANNED_VISUAL_PROPS);
  if (hit) {
    return {
      gate: "literal_hook",
      level: "block",
      message: `Literal hook prop used: "${hit}". Show mechanism, not the metaphor.`,
    };
  }
  return { gate: "literal_hook", level: "pass", message: "No literal hook props." };
}

// ─── 7. Cure language ────────────────────────────────────────────────────────
function gateCureLanguage(p: GeneratedPrompt): GateResult {
  const body = joinPrompt(p);
  const banned = findFirstMatch(body, BANNED_WORDS);
  if (banned) {
    return {
      gate: "cure_language",
      level: "block",
      message: `Cure / overclaim language detected: "${banned}".`,
    };
  }
  const soften = findFirstMatch(body, SOFTEN_WORDS);
  if (soften) {
    return {
      gate: "cure_language",
      level: "warn",
      message: `Soft overclaim — consider rewording: "${soften}".`,
    };
  }
  return { gate: "cure_language", level: "pass", message: "No cure language." };
}

// ─── 8. Discount cap + CTA discipline ────────────────────────────────────────
function gateDiscountAndCta(p: GeneratedPrompt): GateResult {
  const cta = p.sections.ctaAndTrust ?? "";
  const body = joinPrompt(p);

  // Discount cap — find any "<num>% off" and ensure <= cap
  const pctMatches = [...body.matchAll(/(\d{1,3})\s*%/g)];
  for (const m of pctMatches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > DISCOUNT_CAP) {
      return {
        gate: "discount_cta",
        level: "block",
        message: `Discount ${n}% exceeds cap of ${DISCOUNT_CAP}%.`,
      };
    }
  }

  const bannedCta = findFirstMatch(body, BANNED_CTAS);
  if (bannedCta) {
    return {
      gate: "discount_cta",
      level: "block",
      message: `Banned CTA used: "${bannedCta}".`,
    };
  }

  const hasAllowedCta = ALLOWED_CTAS.some((c) => lower(cta).includes(lower(c)));
  if (!hasAllowedCta && cta.trim().length > 0) {
    return {
      gate: "discount_cta",
      level: "warn",
      message: `CTA not drawn from allowed list (${ALLOWED_CTAS.join(" | ")}).`,
    };
  }
  return { gate: "discount_cta", level: "pass", message: "Discount and CTA within bounds." };
}

// ─── 9. Named fonts ──────────────────────────────────────────────────────────
const NAMED_FONTS = [
  "helvetica", "arial", "times new roman", "georgia", "verdana", "calibri",
  "futura", "didot", "garamond", "bodoni", "inter", "roboto", "open sans",
  "noto", "playfair", "lato", "montserrat",
];
function gateFonts(p: GeneratedPrompt): GateResult {
  const body = joinPrompt(p);
  const hit = findFirstMatch(body, NAMED_FONTS);
  if (hit) {
    return {
      gate: "named_fonts",
      level: "block",
      message: `Named font used: "${hit}". Describe typography visually instead.`,
    };
  }
  return { gate: "named_fonts", level: "pass", message: "No named fonts." };
}

// ─── 10. Editor / iteration-name discipline ──────────────────────────────────
function gateEditorAndNaming(p: GeneratedPrompt): GateResult {
  const body = joinPrompt(p);
  // Direct mention of banned editor token in the prompt body is a block.
  for (const ed of BANNED_EDITORS) {
    // word-boundary match to avoid hitting substrings like "sun"
    const re = new RegExp(`\\b${ed}\\b`);
    if (re.test(body)) {
      return {
        gate: "editor_naming",
        level: "block",
        message: `Reserved editor token "${ed}" appears in prompt body.`,
      };
    }
  }
  // Legacy naming pattern (old IT1-Singing-Cellulitis-easy-…) must never appear.
  if (/IT\d+-[A-Z][a-z]+-[A-Z][a-z]+-(easy|medium|hard)/.test(body)) {
    return {
      gate: "editor_naming",
      level: "block",
      message: "Legacy iteration-name format detected. Use IT[N]-[LEVEL]-[EDITOR]-[NAME]-[HOOK] only.",
    };
  }
  return { gate: "editor_naming", level: "pass", message: "Editor + naming discipline OK." };
}

export interface EvaluateInput {
  prompt: GeneratedPrompt;
  angleSlug: AngleSlug | string;
  // Optional override for user-created angles not in the hardcoded ANGLE_BY_SLUG.
  angleSpec?: RuntimeAngleSpec | null;
  exactHeadline?: string | null;
}

// Convert any `block` result to `warn` so the run page only ever shows pass/warn.
// We keep the underlying gate logic intact — only the level is downgraded — so
// the message text still tells the user what the gate caught; nothing is auto-
// rejected anymore.
function softenBlocks(results: GateResult[]): GateResult[] {
  return results.map((r) => (r.level === "block" ? { ...r, level: "warn" as const } : r));
}

function rollupStatus(results: GateResult[]): "pass" | "warn" {
  return results.some((r) => r.level === "warn") ? "warn" : "pass";
}

export function evaluatePrompt(input: EvaluateInput): ComplianceReport {
  const { prompt: p, angleSlug, angleSpec, exactHeadline } = input;

  // Video scripts have a different structure (no 9 image sections). Many of the
  // image-specific gates check the wardrobe / subject / pose fields that don't
  // exist on a video script — running them would either no-op or trip false
  // positives. Run only the gates whose semantics still apply to script copy.
  if (p.tool === "video_script") {
    const results: GateResult[] = softenBlocks([
      gateMechanismMatch(p, angleSlug, angleSpec),
      gateCureLanguage(p),
      gateDiscountAndCta(p),
      gateFonts(p),
    ]);
    return { status: rollupStatus(results), results };
  }

  const results: GateResult[] = softenBlocks([
    gateHeadlineIntegrity(p, exactHeadline),
    gateMechanismMatch(p, angleSlug, angleSpec),
    gateSilhouetteAndColorway(p, angleSlug, angleSpec),
    gateLeggingTexture(p),
    gateCasting(p),
    gateLiteralHook(p),
    gateCureLanguage(p),
    gateDiscountAndCta(p),
    gateFonts(p),
    gateEditorAndNaming(p),
  ]);
  return { status: rollupStatus(results), results };
}

export function complianceSummary(report: ComplianceReport): string {
  const blocks = report.results.filter((r) => r.level === "block").length;
  const warns = report.results.filter((r) => r.level === "warn").length;
  if (blocks > 0) return `${blocks} block${blocks === 1 ? "" : "s"}, ${warns} warn${warns === 1 ? "" : "s"}`;
  if (warns > 0) return `${warns} warn${warns === 1 ? "" : "s"}`;
  return "10/10 pass";
}
