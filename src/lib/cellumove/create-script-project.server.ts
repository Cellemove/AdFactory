import "server-only";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth";
import {
  buildScriptDisplayName,
  createInitialScriptDocument,
} from "@/lib/cellumove/script-studio";
import { generateResourceGroundedScript } from "@/lib/cellumove/script-generation.server";
import {
  reportScriptGenerationProgress,
  type ScriptGenerationProgressSink,
} from "@/lib/cellumove/script-generation-progress";
import { persistScriptSources } from "@/lib/cellumove/script-sources.server";
import { recordScriptBrollSuggestions } from "@/lib/cellumove/broll-tracking.server";
import { runScriptWorkflowAudit } from "@/lib/cellumove/script-workflow-audit.server";
import { parsePipelineRunSelection } from "@/lib/cellumove/pipeline-selection";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import { createTeardownBrief } from "@/lib/cellumove/teardown-brief";
import {
  ScriptFunnelStageSchema,
  ScriptHeatLevelSchema,
  ScriptReferenceModeSchema,
  ScriptWorkflowSnapshotSchema,
} from "@/lib/cellumove/script-creative-workflow";
import { loadPublishedScriptPlaybook, playbookSnapshot } from "@/lib/cellumove/script-playbook.server";
import type {
  AngleRow,
  AppUserRow,
  Json,
  ProductRow,
  ProductOfferRow,
  ReferenceFormatRow,
  ResearchRow,
  SubAvatarRow,
} from "@/lib/database.types";
import { newId, supabase, unwrap, unwrapOpt } from "@/lib/db";
import { getTeardownDeconstruction } from "@/lib/teardown";

export const CreateScriptProjectSchema = z.object({
  title: z.string().trim().min(2).max(120),
  idea: z.string().trim().min(5).max(4000),
  conceptLabel: z.string().trim().min(1).max(160),
  hookDirection: z.string().trim().max(600).nullable().optional(),
  marketCode: z.string().trim().regex(/^[a-zA-Z]{2,12}$/).transform((value) => value.toUpperCase()),
  heatLevel: ScriptHeatLevelSchema,
  funnelStage: ScriptFunnelStageSchema,
  voicePlan: z.string().trim().min(1).max(160),
  offerId: z.string().nullable().optional(),
  referenceMode: ScriptReferenceModeSchema,
  playbookVersionId: z.string().min(1),
  adNumber: z.string().trim().min(1).max(40),
  creativeName: z.string().trim().min(2).max(120),
  productId: z.string().min(1),
  // The avatar owns the angle (SubAvatar.angleId is a non-null FK), so the form
  // no longer sends one. Still accepted for callers that name an angle directly
  // — the baseline harness, and any project created without an avatar.
  angleId: z.string().min(1).nullable().optional(),
  subAvatarId: z.string().nullable().optional(),
  referenceFormatId: z.string().nullable().optional(),
  strategistUserId: z.string().min(1),
  editorUserId: z.string().nullable().optional(),
  format: z.string().trim().min(1).max(80),
  targetDurationSec: z.number().int().min(5).max(600),
  teardownRecordId: z.string().nullable().optional(),
  pipelineRunId: z.string().nullable().optional(),
  spySweepId: z.string().nullable().optional(),
  spyAdIndex: z.number().int().nonnegative().nullable().optional(),
}).refine((value) => Boolean(value.subAvatarId || value.angleId), {
  message: "Choose an avatar, or name the angle directly.",
  path: ["subAvatarId"],
});

export type CreateScriptProjectInput = z.infer<typeof CreateScriptProjectSchema>;

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseBeats(value: string): ReferenceFormatBeat[] {
  return z.array(z.object({ label: z.string(), time: z.string(), note: z.string() })).parse(JSON.parse(value));
}

export async function createScriptProjectCore(
  input: CreateScriptProjectInput,
  // deferAudit: run the first Workflow audit after the response is sent (request
  // scope only — headless callers leave it off and get the audit inline).
  options: { actor: SessionUser; onProgress?: ScriptGenerationProgressSink; deferAudit?: boolean },
): Promise<{ id: string }> {
  const progress = options.onProgress;
  await reportScriptGenerationProgress(progress, {
    stage: "setup",
    level: "info",
    message: "Validating the creative brief",
  });
  const parsed = CreateScriptProjectSchema.parse(input);

  await reportScriptGenerationProgress(progress, {
    stage: "resources",
    level: "info",
    message: "Loading the selected product, angle, avatar, framework, and source records",
  });
  const [productRaw, strategistRaw, editorRaw, avatarRaw, frameworkRaw, pipelineRunRaw, spySweepRaw, offerRaw, playbook] = await Promise.all([
    supabase.from("Product").select("*").eq("id", parsed.productId).maybeSingle().then(unwrapOpt),
    supabase.from("AppUser").select("*").eq("id", parsed.strategistUserId).maybeSingle().then(unwrapOpt),
    parsed.editorUserId ? supabase.from("AppUser").select("*").eq("id", parsed.editorUserId).maybeSingle().then(unwrapOpt) : null,
    parsed.subAvatarId ? supabase.from("SubAvatar").select("*").eq("id", parsed.subAvatarId).maybeSingle().then(unwrapOpt) : null,
    parsed.referenceFormatId ? supabase.from("ReferenceFormat").select("*").eq("id", parsed.referenceFormatId).maybeSingle().then(unwrapOpt) : null,
    parsed.pipelineRunId ? supabase.from("Research").select("*").eq("id", parsed.pipelineRunId).eq("type", "pipeline").maybeSingle().then(unwrapOpt) : null,
    parsed.spySweepId ? supabase.from("Research").select("*").eq("id", parsed.spySweepId).eq("type", "competitor_spy").maybeSingle().then(unwrapOpt) : null,
    parsed.offerId ? supabase.from("ProductOffer").select("*").eq("id", parsed.offerId).maybeSingle().then(unwrapOpt) : null,
    loadPublishedScriptPlaybook(parsed.playbookVersionId),
  ]);
  const product = productRaw as ProductRow | null;
  const strategist = strategistRaw as AppUserRow | null;
  const editor = editorRaw as AppUserRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  const framework = frameworkRaw as ReferenceFormatRow | null;
  const pipelineRun = pipelineRunRaw as ResearchRow | null;
  const spySweep = spySweepRaw as ResearchRow | null;
  const selectedOffer = offerRaw as ProductOfferRow | null;

  if (parsed.subAvatarId && !avatar) throw new Error("The selected avatar was not found.");

  // The avatar decides the angle. An explicit angleId is only the fallback for a
  // project created without an avatar.
  const angleId = avatar?.angleId ?? parsed.angleId;
  const angle = angleId
    ? (unwrapOpt(await supabase.from("Angle").select("*").eq("id", angleId).maybeSingle()) as AngleRow | null)
    : null;

  if (!product) throw new Error("Product not found.");
  if (!product.code?.trim()) throw new Error("Assign the product a naming code before creating a script.");
  if (!angle) throw new Error("Angle not found.");
  if (!strategist || strategist.role !== "creative_strategist") throw new Error("Select a valid creative strategist.");
  if (parsed.editorUserId && (!editor || editor.role !== "editor")) throw new Error("Select a valid editor.");
  if (parsed.angleId && avatar && avatar.angleId !== parsed.angleId) throw new Error("The selected avatar does not belong to this angle.");
  if (parsed.referenceFormatId && !framework) throw new Error("Reference format not found.");
  const pipelineDoc = pipelineRun ? parsePipelineRunSelection(pipelineRun.drafts) : null;
  if (parsed.pipelineRunId && (!pipelineRun || !pipelineDoc)) throw new Error("The selected pipeline run is unavailable or invalid.");
  // Only the avatar has to match. The run's stored angleSlug can drift from the
  // avatar's real angle, and the avatar is now the authority on which that is.
  if (pipelineDoc && (!avatar || pipelineDoc.subAvatarId !== avatar.id)) {
    throw new Error("The selected pipeline run does not match this avatar.");
  }
  if (pipelineDoc && pipelineDoc.completedStages === 0) throw new Error("The selected pipeline run has no completed stages yet.");
  if (parsed.spySweepId && !spySweep) throw new Error("The selected Spy sweep is unavailable.");
  if (parsed.offerId) {
    if (!selectedOffer || selectedOffer.productId !== product.id || selectedOffer.status !== "approved") {
      throw new Error("The selected offer is unavailable or not approved for this product.");
    }
    if (selectedOffer.marketCode && selectedOffer.marketCode.toUpperCase() !== parsed.marketCode) {
      throw new Error("The selected offer does not apply to this market.");
    }
    const nowMs = Date.now();
    if ((selectedOffer.validFrom && new Date(selectedOffer.validFrom).getTime() > nowMs) || (selectedOffer.validUntil && new Date(selectedOffer.validUntil).getTime() < nowMs)) {
      throw new Error("The selected offer is outside its approved validity window.");
    }
  }

  await reportScriptGenerationProgress(progress, {
    stage: "resources",
    level: "success",
    message: "Creative resources validated",
    detail: [product.name, angle.name, avatar?.name, framework?.name, pipelineRun ? `pipeline ${pipelineRun.id}` : null].filter(Boolean).join(" · "),
  });

  const teardown = parsed.teardownRecordId
    ? await getTeardownDeconstruction(parsed.teardownRecordId)
    : null;
  await reportScriptGenerationProgress(progress, {
    stage: "setup",
    level: "info",
    message: "Building the editable module scaffold",
    detail: teardown ? "Teardown source attached" : "No Teardown source selected",
  });

  const now = new Date();
  const createdAt = now.toISOString();
  const displayName = buildScriptDisplayName({
    strategist: strategist.shortCode || strategist.username,
    editor: editor ? editor.shortCode || editor.username : null,
    adNumber: parsed.adNumber,
    angle: angle.name,
    creativeName: parsed.creativeName,
    productCode: product.code,
    createdAt: now,
  });
  const scaffold = createInitialScriptDocument({
    title: parsed.title,
    product: { id: product.id, name: product.name, code: product.code },
    avatar: avatar ? { id: avatar.id, name: avatar.name } : null,
    angle: { id: angle.id, name: angle.name },
    framework: framework ? { id: framework.id, name: framework.name, beats: parseBeats(framework.beats) } : null,
    format: parsed.format,
    targetDurationSec: parsed.targetDurationSec,
    idea: parsed.idea,
    teardown: teardown ? {
      id: teardown.id,
      title: teardown.ad_name || teardown.original_filename,
      url: teardown.source_url || null,
      brief: createTeardownBrief(teardown.parsed_output),
    } : null,
    workflow: ScriptWorkflowSnapshotSchema.parse({
      brief: {
        conceptLabel: parsed.conceptLabel,
        hookDirection: parsed.hookDirection?.trim() || null,
        marketCode: parsed.marketCode,
        heatLevel: parsed.heatLevel,
        funnelStage: parsed.funnelStage,
        voicePlan: parsed.voicePlan,
        offerId: parsed.offerId ?? null,
        referenceMode: parsed.referenceMode,
        playbookVersionId: playbook.id,
      },
      playbook: playbookSnapshot(playbook),
      evidence: { verbatimIds: [], factIds: [], offerIds: [], referenceIds: [] },
      generatedAt: null,
    }),
  });

  const generated = await generateResourceGroundedScript({
    scaffold,
    idea: parsed.idea,
    product,
    angle,
    avatar,
    framework,
    teardown,
    pipelineRunId: pipelineRun?.id ?? null,
    onProgress: progress,
  });
  const document = generated.document;
  if (spySweep && parsed.spyAdIndex != null) {
    let ad: unknown = null;
    try { ad = JSON.parse(spySweep.drafts)?.[parsed.spyAdIndex] ?? null; } catch { /* validated below */ }
    if (!ad) throw new Error("The selected Spy creative no longer exists.");
    const spySource = {
      sourceType: "research" as const,
      sourceId: spySweep.id,
      title: `Spy creative · item ${parsed.spyAdIndex + 1}`,
      url: (ad as { sourceUrl?: string }).sourceUrl ?? null,
      snapshot: { sweepId: spySweep.id, adIndex: parsed.spyAdIndex, ad },
    };
    generated.sources.push(spySource);
    document.sourceRefs.push({ type: spySource.sourceType, id: spySource.sourceId, title: spySource.title, url: spySource.url });
  }

  const projectId = newId();
  await reportScriptGenerationProgress(progress, {
    stage: "persistence",
    level: "info",
    message: "Saving the script project and generation history",
  });
  try {
    unwrap(await supabase.from("ScriptProject").insert({
      id: projectId,
      title: parsed.title,
      status: "draft",
      strategistUserId: strategist.id,
      editorUserId: editor?.id ?? null,
      createdByUserId: options.actor.id,
      productId: product.id,
      subAvatarId: avatar?.id ?? null,
      angleId: angle.id,
      referenceFormatId: framework?.id ?? null,
      idea: parsed.idea,
      adNumber: parsed.adNumber,
      creativeName: parsed.creativeName,
      format: parsed.format,
      targetDurationSec: parsed.targetDurationSec,
      conceptLabel: parsed.conceptLabel,
      hookDirection: parsed.hookDirection?.trim() || null,
      marketCode: parsed.marketCode,
      heatLevel: parsed.heatLevel,
      funnelStage: parsed.funnelStage,
      voicePlan: parsed.voicePlan,
      offerId: parsed.offerId ?? null,
      referenceMode: parsed.referenceMode,
      playbookVersionId: playbook.id,
      teardownRecordId: teardown?.id ?? null,
      teardownSnapshot: teardown ? asJson(teardown) : null,
      document: asJson(document),
      displayName,
      revision: 0,
      currentVersion: 1,
      createdAt,
      updatedAt: createdAt,
    }).select("id").single());
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: "Script project saved" });

    unwrap(await supabase.from("ScriptVersion").insert({
      id: newId(), projectId, version: 1, document: asJson(document), origin: "generated",
      changeSummary: "AI-generated resource-grounded first draft", model: generated.model,
      promptVersion: generated.promptVersion, createdByUserId: options.actor.id, createdAt,
    }).select("id").single());
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: "Version 1 snapshot saved" });

    unwrap(await supabase.from("ScriptAssignment").insert({
      id: newId(), projectId, editorUserId: editor?.id ?? null,
      status: editor ? "assigned" : "available", assignedAt: editor ? createdAt : null,
      createdAt, updatedAt: createdAt,
    }).select("id").single());
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: editor ? "Video editor reserved; draft remains with the strategist" : "Video editor can be assigned later" });

    await persistScriptSources(projectId, generated.sources, createdAt);
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: `${generated.sources.length} source receipts saved` });

    try {
      const suggestionCount = await recordScriptBrollSuggestions(projectId, document);
      await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: `${suggestionCount} new B-roll suggestions recorded` });
    } catch (trackingError) {
      await reportScriptGenerationProgress(progress, { stage: "persistence", level: "warning", message: "Script saved, but B-roll suggestion counters could not be updated", detail: trackingError instanceof Error ? trackingError.message : String(trackingError) });
    }

    unwrap(await supabase.from("ScriptEvent").insert({
      id: newId(), projectId, actorUserId: options.actor.id, eventType: "project_created",
      payload: asJson({
        editorUserId: editor?.id ?? null,
        teardownRecordId: teardown?.id ?? null,
        pipelineRunId: pipelineRun?.id ?? null,
        spySweepId: spySweep?.id ?? null,
        spyAdIndex: parsed.spyAdIndex ?? null,
        workflow: generated.document.workflow,
        generation: {
          model: generated.model,
          promptVersion: generated.promptVersion,
          resourceCounts: generated.resourceCounts,
        },
      }),
      createdAt,
    }).select("id").single());

    try {
      const savedProject = unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()) as import("@/lib/database.types").ScriptProjectRow | null;
      const runAudit = () => runScriptWorkflowAudit({ project: savedProject!, document, revision: 0, scriptVersion: 1, actorUserId: options.actor.id });
      if (savedProject && options.deferAudit) {
        after(() => runAudit().catch((auditError) => console.warn("[scripts] deferred workflow audit failed:", auditError instanceof Error ? auditError.message : String(auditError))));
        await reportScriptGenerationProgress(progress, { stage: "validation", level: "info", message: "First Creative Workflow audit is running in the background", detail: "The score appears in the Workflow panel shortly after the script opens." });
      } else if (savedProject) {
        await reportScriptGenerationProgress(progress, { stage: "validation", level: "info", message: "Running the first Creative Workflow audit" });
        const audit = await runAudit();
        await reportScriptGenerationProgress(progress, { stage: "validation", level: "success", message: `Workflow audit complete · ${Math.round(audit.run.score ?? 0)}/100`, detail: "This playbook score is separate from the evidence scorer." });
      }
    } catch (auditError) {
      await reportScriptGenerationProgress(progress, { stage: "validation", level: "warning", message: "Script saved, but its first Workflow audit could not finish", detail: auditError instanceof Error ? auditError.message : String(auditError) });
    }
  } catch (error) {
    await supabase.from("ScriptProject").delete().eq("id", projectId);
    const message = error instanceof Error ? error.message : String(error);
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "error", message: "Saving failed; partial project data was rolled back", detail: message });
    throw error;
  }

  await reportScriptGenerationProgress(progress, {
    stage: "complete",
    level: "success",
    message: "Complete editable script is ready",
    detail: `${document.modules.length} modules · ${document.modules.reduce((sum, module) => sum + module.durationSec, 0)} seconds estimated delivery`,
  });
  revalidatePath("/scripts");
  return { id: projectId };
}
