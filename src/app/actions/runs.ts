"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";
import type {
  AngleRow,
  SubAvatarRow,
  AvatarResearchRow,
  WinningAdRow,
  BigSwingRow,
  BriefRow,
  RunRow,
  SettingsRow,
} from "@/lib/database.types";
import { ANGLE_BY_SLUG, type AngleSlug } from "@/lib/cellumove/angles";
import { runPromptEngine, type EngineInput } from "@/lib/cellumove/prompt-engine";
import { loadWinnerPerformanceSummary } from "@/app/actions/performance";
import { evaluatePrompt } from "@/lib/cellumove/compliance";
import { isLLMConfigured, DEFAULT_MODEL } from "@/lib/llm";

type SubWithResearch = SubAvatarRow & { research: AvatarResearchRow | null };

const Funnel = z.enum(["TOFU", "MOFU", "BOFU"]);

const CreateBriefAndRunSchema = z.object({
  angleSlug: z.string().min(1),
  subAvatarId: z.string().optional().nullable(),
  lane: z.enum(["iterate", "big_swing", "ai_research"]),
  conceptResearchFocus: z.string().optional().nullable(),
  adType: z.enum(["static", "video"]).optional().nullable(),
  funnel: Funnel.optional().nullable(),
  hook: z.string().optional().nullable(),
  exactHeadline: z.string().optional().nullable(),
  visualConcept: z.string().optional().nullable(),
  targetCount: z.coerce.number().int().min(1).max(40).optional(),
  parentWinnerId: z.string().optional().nullable(),
  iterationVar: z.string().optional().nullable(),
  hypothesis: z.string().optional().nullable(),
  bigSwingId: z.string().optional().nullable(),
  hookMechanic: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CreateBriefAndRunInput = z.input<typeof CreateBriefAndRunSchema>;

export async function createBriefAndRun(input: CreateBriefAndRunInput) {
  const parsed = CreateBriefAndRunSchema.parse(input);

  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("slug", parsed.angleSlug).maybeSingle(),
  ) as AngleRow | null;
  if (!angle) throw new Error(`Unknown angle: ${parsed.angleSlug}`);

  // Build a runtime spec from the DB row so engine + compliance work for user-
  // created angles that aren't in the hardcoded ANGLE_BY_SLUG.
  const angleSpec = {
    slug: angle.slug,
    name: angle.name,
    requiredKeyword: angle.requiredKeyword,
    mechanism: angle.mechanism,
    bannedMechanism: angle.bannedMechanism,
    silhouette: angle.silhouette,
    colorway: angle.colorway,
  };

  const subRes = parsed.subAvatarId
    ? await supabase
        .from("SubAvatar")
        .select("*, research:AvatarResearch(*)")
        .eq("id", parsed.subAvatarId)
        .maybeSingle()
    : null;
  const sub = (subRes ? unwrapOpt(subRes) : null) as SubWithResearch | null;
  if (parsed.subAvatarId) {
    if (!sub) throw new Error("Sub-avatar not found");
    if (!sub.research) {
      throw new Error(
        `Sub-avatar "${sub.name}" has no research. The wizard requires research before generation.`,
      );
    }
  }

  let parent: { id: string; adName: string; headline: string; visualConcept: string; funnel: string; hookType: string | null } | null = null;
  if (parsed.lane === "iterate") {
    if (!parsed.parentWinnerId) throw new Error("Iterate lane requires parentWinnerId");
    parent = unwrapOpt(
      await supabase.from("WinningAd").select("*").eq("id", parsed.parentWinnerId).maybeSingle(),
    ) as WinningAdRow | null;
    if (!parent) throw new Error("Parent winner not found");
  }

  let bigSwing: { id: string; funnel: string; format: string; name: string } | null = null;
  if (parsed.lane === "big_swing" && parsed.bigSwingId) {
    bigSwing = unwrapOpt(
      await supabase.from("BigSwing").select("*").eq("id", parsed.bigSwingId).maybeSingle(),
    ) as BigSwingRow | null;
  }

  // Derive funnel from lane context when the caller didn't pin one:
  // iterate → parent winner's funnel, big_swing → format's funnel, else MOFU.
  const funnel: "TOFU" | "MOFU" | "BOFU" =
    parsed.funnel ??
    (parent?.funnel as "TOFU" | "MOFU" | "BOFU" | undefined) ??
    (bigSwing?.funnel as "TOFU" | "MOFU" | "BOFU" | undefined) ??
    "MOFU";

  let targetCount: number = parsed.targetCount ?? 0;
  if (!targetCount) {
    const settings = unwrapOpt(
      await supabase.from("Settings").select("*").eq("id", "default").maybeSingle(),
    ) as SettingsRow | null;
    targetCount = settings?.defaultTargetCount ?? 25;
  }

  const brief = unwrap(
    await supabase
      .from("Brief")
      .insert({
        id: newId(),
        angleId: angle.id,
        subAvatarId: sub?.id ?? null,
        lane: parsed.lane,
        funnel,
        hook: parsed.hook ?? "",
        exactHeadline: parsed.exactHeadline ?? "",
        visualConcept: parsed.visualConcept ?? "",
        targetCount,
        parentWinnerId: parent?.id ?? null,
        iterationVar: parsed.iterationVar ?? null,
        hypothesis: parsed.hypothesis ?? null,
        bigSwingId: bigSwing?.id ?? null,
        hookMechanic: parsed.hookMechanic ?? null,
        notes: parsed.notes ?? null,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  ) as BriefRow;

  const run = unwrap(
    await supabase
      .from("Run")
      .insert({
        id: newId(),
        briefId: brief.id,
        angleId: angle.id,
        status: "running",
        model: DEFAULT_MODEL,
        startedAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  ) as RunRow;

  if (!isLLMConfigured()) {
    const { error } = await supabase
      .from("Run")
      .update({
        status: "failed",
        error: "GOOGLE_CLOUD_PROJECT not configured — add it to .env and retry.",
        finishedAt: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (error) throw new Error(error.message);
    revalidatePath("/runs");
    return { briefId: brief.id, runId: run.id };
  }

  try {
    const engineInput: EngineInput = {
      angleSlug: parsed.angleSlug,
      angleSpec,
      adType: parsed.adType ?? "static",
      conceptResearchFocus: parsed.conceptResearchFocus ?? null,
      subAvatarName: sub?.name ?? null,
      subAvatarShortDesc: sub?.shortDesc ?? null,
      research: sub?.research
        ? {
            painPoints: sub.research.painPoints,
            desires: sub.research.desires,
            objections: sub.research.objections,
            dailyLanguage: sub.research.dailyLanguage,
            triggers: sub.research.triggers,
            identity: sub.research.identity,
            socialProof: sub.research.socialProof,
            buyingContext: sub.research.buyingContext,
          }
        : null,
      lane: parsed.lane,
      funnel,
      hook: parsed.hook ?? null,
      exactHeadline: parsed.exactHeadline ?? null,
      visualConcept: parsed.visualConcept ?? null,
      targetCount,
      parent: parent
        ? {
            adName: parent.adName,
            headline: parent.headline,
            visualConcept: parent.visualConcept,
            funnel: parent.funnel as "TOFU" | "MOFU" | "BOFU",
            hookType: parent.hookType,
            // Feed the winner's real KPIs into the iterate prompt (null if none entered).
            performanceSummary: await loadWinnerPerformanceSummary(parent.id),
          }
        : undefined,
      iterationVar: parsed.iterationVar ?? undefined,
      hypothesis: parsed.hypothesis ?? undefined,
      bigSwingFormat: (bigSwing?.format as EngineInput["bigSwingFormat"]) ?? undefined,
      hookMechanic: (parsed.hookMechanic as EngineInput["hookMechanic"]) ?? undefined,
    };

    const prompts = await runPromptEngine(engineInput);

    const now = new Date().toISOString();
    const rows = prompts.map((p) => {
      const report = evaluatePrompt({
        prompt: p,
        angleSlug: parsed.angleSlug,
        angleSpec,
        exactHeadline: parsed.exactHeadline ?? null,
      });
      return {
        id: newId(),
        runId: run.id,
        index: p.index,
        promptJson: JSON.stringify(p),
        promptText: p.promptText,
        tool: p.tool,
        level: p.level,
        hook: p.hook,
        headlineRendered: p.headlineRendered,
        complianceStatus: report.status,
        complianceNotes: JSON.stringify(report.results),
        createdAt: now,
        updatedAt: now,
      };
    });
    const { error: insErr } = await supabase.from("Generation").insert(rows);
    if (insErr) throw new Error(insErr.message);

    const { error: completeErr } = await supabase
      .from("Run")
      .update({ status: "complete", finishedAt: new Date().toISOString() })
      .eq("id", run.id);
    if (completeErr) throw new Error(completeErr.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("Run")
      .update({ status: "failed", error: msg, finishedAt: new Date().toISOString() })
      .eq("id", run.id);
  }

  revalidatePath("/runs");
  return { briefId: brief.id, runId: run.id };
}

const VerdictSchema = z.object({
  generationId: z.string().min(1),
  verdict: z.enum(["approved", "rejected", "regenerate"]),
  note: z.string().optional().nullable(),
});

export async function setVerdict(input: z.infer<typeof VerdictSchema>) {
  const parsed = VerdictSchema.parse(input);
  const updated = unwrap(
    await supabase
      .from("Generation")
      .update({ verdict: parsed.verdict, verdictNote: parsed.note ?? null, updatedAt: new Date().toISOString() })
      .eq("id", parsed.generationId)
      .select("*")
      .single(),
  ) as { runId: string };
  revalidatePath(`/runs/${updated.runId}`);
  return updated;
}

export async function summarizeRun(runId: string) {
  const gens = unwrap(await supabase.from("Generation").select("complianceStatus").eq("runId", runId));
  let pass = 0, warn = 0, block = 0;
  for (const g of gens) {
    if (g.complianceStatus === "pass") pass++;
    else if (g.complianceStatus === "warn") warn++;
    else if (g.complianceStatus === "block") block++;
  }
  return { pass, warn, block, total: gens.length };
}
