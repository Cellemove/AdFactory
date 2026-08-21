"use server";

import { z } from "zod";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { runAgent, extractJsonObject } from "@/lib/cellumove/agents";
import { resolveAngle } from "@/lib/cellumove/angles";
import { evaluatePrompt } from "@/lib/cellumove/compliance";
import { exclusionBlock } from "@/lib/cellumove/novelty";
import { brollLibraryContext, recordBrollSuggestions } from "@/app/actions/broll";
import {
  parseAvatarProfile,
  avatarForbiddenWords,
  renderCopywriterProfile,
  renderStrategistProfile,
  renderDesignerProfile,
} from "@/lib/cellumove/avatar-profile";
import type { GeneratedPrompt } from "@/lib/cellumove/prompt-engine";
import type {
  SubAvatarRow,
  AvatarResearchRow,
  AngleRow,
  MarketProfileRow,
  ReferenceFormatRow,
} from "@/lib/database.types";

// ─── Output shapes (also consumed by the /script page) ───────────────────────

export interface StrategicBrief {
  formatSlug: string;
  formatName: string;
  positioning: string;     // 1-line strategic angle
  coreMessage: string;
  hookDirection: string;
  proofToUse: string;
  notes: string;
}
export interface ScriptHook {
  label: string;
  mechanic: string;        // which hook mechanic (must differ across the 3)
  text: string;
}
export interface ScriptBeat {
  label: string;
  time: string;
  visual: string;
  onScreenText: string;
  voiceover: string;
}
export interface CopywrittenScript {
  formatSlug: string;
  title: string;
  hooks: ScriptHook[];
  beats: ScriptBeat[];
  fullText: string;        // flattened — used for the compliance scan + display
}
export interface ComplianceVerdict {
  formatSlug: string;
  status: "pass" | "warn";
  issues: string[];        // gate messages + market-claim hits
  corrected: boolean;      // true if a corrective copywriter pass was applied
}
export interface DesignPackage {
  formatSlug: string;
  brollByBeat: Array<{ beat: string; suggestions: string[] }>;
  ugcBrief: string;
  missingClips: string[];
  // For each missing clip: how to fill the gap without a shoot — an AI video-gen
  // prompt and a TikTok search query to scrap a similar clip.
  fallbacks?: Array<{ need: string; aiVideoPrompt: string; tiktokSearch: string }>;
}
export interface ScriptPackage {
  brief: StrategicBrief;
  script: CopywrittenScript;
  compliance: ComplianceVerdict;
  design: DesignPackage;
}
export interface PipelineResult {
  subAvatarName: string;
  angleName: string;
  marketName: string | null;
  packages: ScriptPackage[];
}

const InputSchema = z.object({
  subAvatarId: z.string().min(1),
  coreIdea: z.string().min(3),
  formatSlugs: z.array(z.string()).optional(),
  formatCount: z.number().int().min(1).max(5).optional(),
  marketCode: z.string().optional().nullable(),
  targetDurationSec: z.number().int().optional().nullable(),
});

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Cross-run novelty: positionings, core messages, hook directions, titles, and
// hooks we've ALREADY produced for this same avatar+angle in prior script runs.
// Fed into the strategist + copywriter so a re-run diverges instead of repeating.
// Fail-soft → [] (novelty is best-effort, never a hard dependency).
async function priorScriptItems(subName: string, angleSlug: string): Promise<string[]> {
  try {
    const res = await supabase
      .from("Research")
      .select("drafts")
      .eq("type", "script_pipeline")
      .eq("focus", subName)
      .eq("angleSlug", angleSlug)
      .order("createdAt", { ascending: false })
      .limit(8);
    if (res.error) return [];
    const items: string[] = [];
    for (const row of (res.data ?? []) as { drafts: string }[]) {
      try {
        const parsed = JSON.parse(row.drafts) as {
          packages?: Array<{
            brief?: { positioning?: string; coreMessage?: string; hookDirection?: string };
            script?: { title?: string; hooks?: Array<{ text?: string }> };
          }>;
        };
        for (const p of parsed.packages ?? []) {
          for (const s of [p.brief?.positioning, p.brief?.coreMessage, p.brief?.hookDirection, p.script?.title]) {
            if (s && s.trim()) items.push(s);
          }
          for (const h of p.script?.hooks ?? []) if (h?.text?.trim()) items.push(h.text);
        }
      } catch {
        /* skip unparseable row */
      }
    }
    return items;
  } catch {
    return [];
  }
}

// ─── Context loading + minimum-context gate (Module 5 SOP) ───────────────────

async function loadContext(input: z.infer<typeof InputSchema>) {
  const sub = unwrapOpt(
    await supabase.from("SubAvatar").select("*").eq("id", input.subAvatarId).maybeSingle(),
  ) as SubAvatarRow | null;
  if (!sub) throw new Error("Sub-avatar not found.");

  const research = unwrapOpt(
    await supabase.from("AvatarResearch").select("*").eq("subAvatarId", sub.id).maybeSingle(),
  ) as AvatarResearchRow | null;

  // Minimum-context gate: standalone generation needs real customer language.
  const missing: string[] = [];
  if (!research) missing.push("no research attached to this sub-avatar");
  else {
    if (!research.painPoints?.trim()) missing.push("pain points");
    if (!research.dailyLanguage?.trim()) missing.push("daily language / vocabulary");
    if (!research.triggers?.trim()) missing.push("trigger moments");
  }
  if (missing.length) {
    throw new Error(
      `Not enough context to generate without going generic. This sub-avatar is missing: ${missing.join(", ")}. Add it under /avatars first.`,
    );
  }

  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("id", sub.angleId).maybeSingle(),
  ) as AngleRow | null;
  if (!angle) throw new Error("Angle for this sub-avatar not found.");

  let market: MarketProfileRow | null = null;
  if (input.marketCode) {
    const res = await supabase.from("MarketProfile").select("*").eq("code", input.marketCode).maybeSingle();
    market = res.error ? null : (res.data as MarketProfileRow | null);
  }

  let formats: ReferenceFormatRow[] = [];
  if (input.formatSlugs?.length) {
    const res = await supabase.from("ReferenceFormat").select("*").in("slug", input.formatSlugs);
    formats = res.error ? [] : ((res.data ?? []) as ReferenceFormatRow[]);
  } else {
    const res = await supabase
      .from("ReferenceFormat")
      .select("*")
      .order("order", { ascending: true })
      .limit(input.formatCount ?? 3);
    formats = res.error ? [] : ((res.data ?? []) as ReferenceFormatRow[]);
  }
  if (formats.length === 0) {
    throw new Error("No reference formats available. Run `npm run seed:sop` to load them.");
  }

  // The structured deep dive, when research captured one (null for flat-only rows).
  const profile = parseAvatarProfile(research!.profile);

  return { sub, research: research!, angle, market, formats, profile };
}

// Render a reference format's beats for a prompt.
function describeFormat(f: ReferenceFormatRow): string {
  let beats: Array<{ label?: string; time?: string; note?: string }> = [];
  try { beats = JSON.parse(f.beats || "[]"); } catch { /* */ }
  const beatLines = beats.map((b) => `    - ${b.time ?? ""} ${b.label ?? ""}: ${b.note ?? ""}`).join("\n");
  return `  • ${f.name} (${f.slug})${f.optimalDurationSec ? ` ~${f.optimalDurationSec}s` : ""}\n    ${f.description}\n${beatLines}`;
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

function researchBlock(ctx: Ctx): string {
  const r = ctx.research;
  return [
    `SUB-AVATAR: ${ctx.sub.name}${ctx.sub.shortDesc ? ` — ${ctx.sub.shortDesc}` : ""}`,
    `ANGLE: ${ctx.angle.name} (${ctx.angle.slug}) — mechanism to teach: ${ctx.angle.mechanism}`,
    `  Mechanisms BANNED for this angle: ${ctx.angle.bannedMechanism}`,
    "",
    "CUSTOMER RESEARCH (use their actual words):",
    `  Pain points: ${r.painPoints}`,
    `  Desires: ${r.desires}`,
    `  Objections: ${r.objections}`,
    `  Daily language: ${r.dailyLanguage}`,
    `  Triggers: ${r.triggers}`,
    `  Identity: ${r.identity}`,
    `  Social proof that lands: ${r.socialProof}`,
    `  Buying context: ${r.buyingContext}`,
    ctx.market ? `\nMARKET: ${ctx.market.name} (${ctx.market.code}) — tone: ${ctx.market.tone}` : "",
  ].join("\n");
}

// ─── Stage 1 — Strategist ────────────────────────────────────────────────────

async function runStrategist(
  ctx: Ctx,
  input: z.infer<typeof InputSchema>,
  novelty: string,
): Promise<StrategicBrief[]> {
  const instruction = [
    "You are the Creative Strategist — the orchestrator. You make the high-level decisions: angle, core message, hook direction, and which proof to use.",
    "You are given a sub-avatar with deep research, an optional market profile, a core idea from the strategist, and a set of reference formats.",
    "Produce EXACTLY ONE strategic brief per reference format provided. Each brief adapts the core idea to that format's structure and the avatar's real language.",
    "Do not write the script — that's the Copywriter's job. Decide the strategy and hand off.",
    'Return ONLY JSON: {"briefs":[{"formatSlug","formatName","positioning","coreMessage","hookDirection","proofToUse","notes"}]}',
  ].join("\n");

  const context = [
    researchBlock(ctx),
    renderStrategistProfile(ctx.profile),
    "",
    `CORE IDEA FROM STRATEGIST: ${input.coreIdea}`,
    input.targetDurationSec ? `TARGET DURATION: ~${input.targetDurationSec}s` : "",
    novelty,
    "",
    "REFERENCE FORMATS (one brief each):",
    ctx.formats.map(describeFormat).join("\n"),
  ].filter(Boolean).join("\n");

  const text = await runAgent({
    role: "strategist",
    instruction,
    context,
    marketCode: input.marketCode,
    json: true,
    feature: "pipeline_strategist",
    metadata: { subAvatarId: ctx.sub.id, formats: ctx.formats.length },
  });
  const parsed = extractJsonObject<{ briefs?: StrategicBrief[] }>(text);
  if (!Array.isArray(parsed.briefs)) throw new Error("Strategist returned no briefs.");
  return parsed.briefs;
}

// ─── Stage 2 — Copywriter ────────────────────────────────────────────────────

function copywriterInstruction(): string {
  return [
    "You are the Copywriter. You turn strategic briefs into shootable video scripts.",
    "For EACH brief, write one script that fills its reference format's beats, plus 3 strategically DIFFERENT opening hooks — each must use a different mechanic (e.g. curiosity, identification, contrarian). Never 3 variants of the same idea.",
    "Speak the avatar's language — reuse phrasing from the daily-language and pain-point research. Be concrete and specific.",
    "CLAIMS GUARDRAIL: never use cure/eliminate/gone/removes language. Compression supports; it does not cure. Use 'smoother / less noticeable / the appearance of'. Honesty builds skeptic trust.",
    "Keep the angle's mechanism correct; never leak a banned mechanism from another angle.",
    'Return ONLY JSON: {"scripts":[{"formatSlug","title","hooks":[{"label","mechanic","text"}],"beats":[{"label","time","visual","onScreenText","voiceover"}],"fullText"}]}',
    '"fullText" is the whole script flattened to plain text (title, the 3 hooks, then each beat) — it is what compliance scans, so include all copy there.',
  ].join("\n");
}

async function runCopywriter(
  ctx: Ctx,
  briefs: StrategicBrief[],
  input: z.infer<typeof InputSchema>,
  novelty: string,
): Promise<CopywrittenScript[]> {
  const context = [
    researchBlock(ctx),
    renderCopywriterProfile(ctx.profile),
    "",
    "BRIEFS TO EXECUTE (one script each):",
    JSON.stringify(briefs, null, 2),
    novelty,
    "",
    "REFERENCE FORMAT STRUCTURES:",
    ctx.formats.map(describeFormat).join("\n"),
  ].filter(Boolean).join("\n");

  const text = await runAgent({
    role: "copywriter",
    instruction: copywriterInstruction(),
    context,
    marketCode: input.marketCode,
    json: true,
    feature: "pipeline_copywriter",
    metadata: { subAvatarId: ctx.sub.id, briefs: briefs.length },
    maxOutputTokens: 49152,
  });
  const parsed = extractJsonObject<{ scripts?: CopywrittenScript[] }>(text);
  if (!Array.isArray(parsed.scripts)) throw new Error("Copywriter returned no scripts.");
  return parsed.scripts;
}

// ─── Stage 3 — Compliance (deterministic utility + market claims) ────────────

function checkScript(ctx: Ctx, script: CopywrittenScript): ComplianceVerdict {
  // Reuse the engine's gates by shaping the script as a video GeneratedPrompt.
  const gp: GeneratedPrompt = {
    index: 0,
    tool: "video_script",
    level: "medium",
    hook: script.hooks?.[0]?.text ?? "",
    headlineRendered: script.title ?? "",
    sections: {
      scene: "", subject: "", pose: "", wardrobe: "", composition: "",
      lighting: "", mood: "", textOverlay: script.title ?? "", ctaAndTrust: "",
    },
    promptText: script.fullText ?? "",
  };
  const report = evaluatePrompt({ prompt: gp, angleSlug: ctx.angle.slug });
  const issues = report.results
    .filter((r) => r.level === "warn")
    .map((r) => `${r.gate}: ${r.message}`);

  const hay = (script.fullText ?? "").toLowerCase();

  // Market-specific forbidden claims (M11/M12).
  if (ctx.market) {
    const forbidden = parseJsonArray(ctx.market.forbiddenClaims);
    for (const claim of forbidden) {
      if (claim.trim() && hay.includes(claim.toLowerCase())) {
        issues.push(`market(${ctx.market.code}): forbidden claim "${claim}"`);
      }
    }
  }

  // Avatar resonance gate: marketing clichés this avatar rejects (from the deep
  // dive). Not a legal block — a conversion block. Flag so the corrective pass
  // rewrites them into her own phrasing.
  for (const word of avatarForbiddenWords(ctx.profile)) {
    if (word && hay.includes(word)) {
      issues.push(`avatar-voice: rejected cliché "${word}" — rewrite in her own words`);
    }
  }

  return {
    formatSlug: script.formatSlug,
    status: issues.length ? "warn" : "pass",
    issues,
    corrected: false,
  };
}

// One corrective copywriter pass over the scripts that tripped issues.
async function runCorrection(
  ctx: Ctx,
  flagged: Array<{ script: CopywrittenScript; issues: string[] }>,
  input: z.infer<typeof InputSchema>,
): Promise<Map<string, CopywrittenScript>> {
  const context = [
    researchBlock(ctx),
    renderCopywriterProfile(ctx.profile),
    "",
    "The compliance checker flagged these scripts. Rewrite ONLY the offending copy to clear every issue listed, keeping the structure, hooks count, and intent intact.",
    "If an issue is a banned avatar-voice phrase, replace it with the avatar's own phrasing above — never with another cliché.",
    JSON.stringify(
      flagged.map((f) => ({ issues: f.issues, script: f.script })),
      null,
      2,
    ),
    "",
    'Return ONLY JSON: {"scripts":[{"formatSlug","title","hooks":[{"label","mechanic","text"}],"beats":[{"label","time","visual","onScreenText","voiceover"}],"fullText"}]} — one corrected script per input.',
  ].filter(Boolean).join("\n");

  const text = await runAgent({
    role: "copywriter",
    instruction: copywriterInstruction(),
    context,
    marketCode: input.marketCode,
    json: true,
    feature: "pipeline_copywriter_fix",
    metadata: { subAvatarId: ctx.sub.id, fixing: flagged.length },
    maxOutputTokens: 32768,
  });
  const parsed = extractJsonObject<{ scripts?: CopywrittenScript[] }>(text);
  const map = new Map<string, CopywrittenScript>();
  for (const s of parsed.scripts ?? []) map.set(s.formatSlug, s);
  return map;
}

// ─── Stage 4 — Designer ──────────────────────────────────────────────────────

async function runDesigner(
  ctx: Ctx,
  scripts: CopywrittenScript[],
  input: z.infer<typeof InputSchema>,
): Promise<DesignPackage[]> {
  const broll = await brollLibraryContext();
  const instruction = [
    "You are the Visual Designer. You turn finished scripts into shootable/designable plans.",
    "For EACH script: (1) suggest concrete B-roll per beat, (2) write a short UGC creator brief (look, props, shots, mood), (3) flag B-roll we most likely DON'T have and would need to shoot, (4) for EVERY missing clip give a fallback so the editor is never blocked: a ready-to-run AI video-generation prompt (subject, action, setting, camera, style, 5-8s) AND a TikTok search query likely to surface a scrappable similar clip.",
    "Match B-roll to the angle's mechanism cue without being literal (no clocks for time, no oranges for orange-peel).",
    broll
      ? "A B-ROLL LIBRARY of clips we ALREADY have is provided below. For each beat, prefer a real clip from it and name it exactly; only list truly-missing shots in missingClips."
      : "",
    'Return ONLY JSON: {"designs":[{"formatSlug","brollByBeat":[{"beat","suggestions":["..."]}],"ugcBrief","missingClips":["..."],"fallbacks":[{"need","aiVideoPrompt","tiktokSearch"}]}]}',
  ].filter(Boolean).join("\n");

  const context = [
    `ANGLE: ${ctx.angle.name} — mechanism cue: ${ctx.angle.mechanism}`,
    ctx.market ? `MARKET: ${ctx.market.name} (${ctx.market.code})` : "",
    renderDesignerProfile(ctx.profile),
    broll,
    "",
    "FINISHED SCRIPTS:",
    JSON.stringify(scripts, null, 2),
  ].filter(Boolean).join("\n");

  const text = await runAgent({
    role: "designer",
    instruction,
    context,
    marketCode: input.marketCode,
    json: true,
    feature: "pipeline_designer",
    metadata: { subAvatarId: ctx.sub.id, scripts: scripts.length },
    maxOutputTokens: 32768,
  });
  const parsed = extractJsonObject<{ designs?: DesignPackage[] }>(text);
  return Array.isArray(parsed.designs) ? parsed.designs : [];
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function runScriptPipeline(rawInput: z.infer<typeof InputSchema>): Promise<PipelineResult> {
  const input = InputSchema.parse(rawInput);
  const ctx = await loadContext(input);

  // Cross-run novelty: what we've already produced for this avatar+angle, so a
  // re-run finds fresh angles/hooks instead of restating the last one.
  const priorItems = await priorScriptItems(ctx.sub.name, ctx.angle.slug);
  const novelty = exclusionBlock(
    "ALREADY PRODUCED FOR THIS AVATAR IN PRIOR SCRIPT RUNS — DO NOT REPEAT",
    "You've already used these positionings, core messages, hook directions, titles, and hooks for this same avatar+angle. Produce genuinely DIFFERENT strategy and hooks — new angles, new mechanics, new phrasing. Do not reword these:",
    priorItems,
  );

  // 1. Strategist → briefs
  const briefs = await runStrategist(ctx, input, novelty);

  // 2. Copywriter → scripts
  const scripts = await runCopywriter(ctx, briefs, input, novelty);
  const scriptBySlug = new Map(scripts.map((s) => [s.formatSlug, s]));

  // 3. Compliance utility (deterministic) → verdicts + one corrective pass
  const verdicts = new Map<string, ComplianceVerdict>();
  for (const s of scripts) verdicts.set(s.formatSlug, checkScript(ctx, s));

  const flagged = scripts
    .map((s) => ({ script: s, verdict: verdicts.get(s.formatSlug)! }))
    .filter((x) => x.verdict.status === "warn" && x.verdict.issues.length)
    .map((x) => ({ script: x.script, issues: x.verdict.issues }));

  if (flagged.length) {
    try {
      const fixes = await runCorrection(ctx, flagged, input);
      for (const [slug, fixed] of fixes) {
        scriptBySlug.set(slug, fixed);
        const reVerdict = checkScript(ctx, fixed);
        reVerdict.corrected = true;
        verdicts.set(slug, reVerdict);
      }
    } catch {
      // If the corrective pass fails, keep the original scripts + their warnings.
    }
  }

  const finalScripts = Array.from(scriptBySlug.values());

  // 4. Designer → b-roll + UGC briefs
  const designs = await runDesigner(ctx, finalScripts, input);
  const designBySlug = new Map(designs.map((d) => [d.formatSlug, d]));

  // B-roll detection: count which real clips the Designer just suggested, so we
  // can track over-use. Best-effort — never blocks the run.
  const researchId = newId();
  await recordBrollSuggestions(JSON.stringify(designs), "designer", researchId);

  const briefBySlug = new Map(briefs.map((b) => [b.formatSlug, b]));

  const packages: ScriptPackage[] = finalScripts.map((script) => ({
    brief:
      briefBySlug.get(script.formatSlug) ?? {
        formatSlug: script.formatSlug,
        formatName: script.formatSlug,
        positioning: "", coreMessage: "", hookDirection: "", proofToUse: "", notes: "",
      },
    script,
    compliance:
      verdicts.get(script.formatSlug) ?? {
        formatSlug: script.formatSlug, status: "pass", issues: [], corrected: false,
      },
    design:
      designBySlug.get(script.formatSlug) ?? {
        formatSlug: script.formatSlug, brollByBeat: [], ugcBrief: "", missingClips: [], fallbacks: [],
      },
  }));

  const result: PipelineResult = {
    subAvatarName: ctx.sub.name,
    angleName: ctx.angle.name,
    marketName: ctx.market?.name ?? null,
    packages,
  };

  // Persist the run so cross-run novelty has a pool to exclude against next time.
  // Best-effort: a persistence hiccup must not fail an otherwise-good generation.
  try {
    await supabase.from("Research").insert({
      id: researchId,
      type: "script_pipeline",
      angleSlug: ctx.angle.slug,
      focus: ctx.sub.name,
      drafts: JSON.stringify(result),
      status: "done",
      createdAt: new Date().toISOString(),
    });
  } catch {
    /* novelty is best-effort — ignore persistence errors */
  }

  return result;
}
