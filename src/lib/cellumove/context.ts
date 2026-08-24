// Shared avatar-context builders — the blocks every generative feature feeds its
// prompts: the G1 research, the structured profile rendered per role, and the G2
// deep-dive sample. Extracted from actions/pipeline-run.ts so the copywriter
// workbench (actions/copywriter.ts) can reuse them ("use server" files can only
// export async functions, so these live here).

import { supabase, unwrapOpt } from "../db";
import {
  parseAvatarProfile,
  renderStrategistProfile,
  renderCopywriterProfile,
  renderDesignerProfile,
} from "./avatar-profile";
import type { AgentRole } from "./agents";
import type { SubAvatarRow, AvatarResearchRow, AngleRow } from "../database.types";

export async function loadAvatarContext(subAvatarId: string) {
  const sub = unwrapOpt(
    await supabase.from("SubAvatar").select("*").eq("id", subAvatarId).maybeSingle(),
  ) as SubAvatarRow | null;
  if (!sub) throw new Error("Sub-avatar not found.");

  const research = unwrapOpt(
    await supabase.from("AvatarResearch").select("*").eq("subAvatarId", sub.id).maybeSingle(),
  ) as AvatarResearchRow | null;

  // Generation needs the avatar excavation (G1) + deep dive (G2) already done.
  const missing: string[] = [];
  if (!research) missing.push("no research attached");
  else {
    if (!research.painPoints?.trim()) missing.push("pain points");
    if (!research.dailyLanguage?.trim()) missing.push("daily language");
    if (!research.triggers?.trim()) missing.push("trigger moments");
  }
  if (missing.length) {
    throw new Error(
      `This avatar isn't ready yet. Missing: ${missing.join(", ")}. Complete G1/G2 (Excavation + Deep Dive) under /avatars or /research first.`,
    );
  }

  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("id", sub.angleId).maybeSingle(),
  ) as AngleRow | null;
  if (!angle) throw new Error("Angle for this sub-avatar not found.");

  const profile = parseAvatarProfile(research!.profile);
  return { sub, research: research!, angle, profile };
}

export type AvatarCtx = Awaited<ReturnType<typeof loadAvatarContext>>;

export function researchBlock(ctx: AvatarCtx): string {
  const r = ctx.research;
  return [
    `SUB-AVATAR: ${ctx.sub.name}${ctx.sub.shortDesc ? ` — ${ctx.sub.shortDesc}` : ""}`,
    `ANGLE: ${ctx.angle.name} (${ctx.angle.slug}) — mechanism to own: ${ctx.angle.mechanism}`,
    `  Mechanisms BANNED for this angle: ${ctx.angle.bannedMechanism}`,
    "",
    "CUSTOMER RESEARCH (G1 Avatar Excavation — use her actual words):",
    `  Pain points: ${r.painPoints}`,
    `  Desires: ${r.desires}`,
    `  Objections: ${r.objections}`,
    `  Daily language: ${r.dailyLanguage}`,
    `  Triggers: ${r.triggers}`,
    `  Identity: ${r.identity}`,
    `  Social proof that lands: ${r.socialProof}`,
    `  Buying context: ${r.buyingContext}`,
  ].join("\n");
}

export function renderProfileFor(role: AgentRole, ctx: AvatarCtx): string {
  switch (role) {
    case "strategist":
      return renderStrategistProfile(ctx.profile);
    case "copywriter":
      return renderCopywriterProfile(ctx.profile);
    case "designer":
      return renderDesignerProfile(ctx.profile);
    default:
      return "";
  }
}

// The grounded G2 research block, fed into downstream prompts as the foundation.
// For a progressive accumulator (which can hold ~1000 verbatims) we feed the
// synthesis + a representative SAMPLE of quotes, not the whole corpus — otherwise
// every downstream prompt balloons by tens of thousands of tokens. Takes the raw
// deepDive stage value (doc.stages.deepDive); "" when absent.
export function deepDiveBlock(deepDive: unknown, verbatimSample = 80): string {
  if (deepDive == null) return "";
  let payload: unknown = deepDive;
  const a = deepDive as {
    kind?: unknown;
    avatar?: unknown;
    synthesis?: unknown;
    threads?: unknown;
    verbatims?: unknown[];
    bigPatterns?: unknown;
    painPoints?: unknown;
    desires?: unknown;
    fears?: unknown;
    objections?: unknown;
    dailyLanguage?: unknown;
    outliers?: unknown;
  };
  if (a.kind === "progressive" && Array.isArray(a.verbatims)) {
    payload = {
      avatar: a.avatar,
      synthesis: a.synthesis, // the decision-ready angle brief
      threadsRead: Array.isArray(a.threads) ? a.threads.length : 0,
      totalVerbatimsCollected: a.verbatims.length,
      bigPatterns: a.bigPatterns,
      painPoints: a.painPoints,
      desires: a.desires,
      fears: a.fears,
      objections: a.objections,
      dailyLanguage: a.dailyLanguage,
      outliers: a.outliers,
      sampleVerbatims: a.verbatims.slice(0, verbatimSample),
    };
  }
  return [
    "GROUNDED DEEP-DIVE RESEARCH (G2) — real findings; build everything on this:",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
