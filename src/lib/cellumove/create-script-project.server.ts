import "server-only";

import { revalidatePath } from "next/cache";
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
import { parsePipelineRunSelection } from "@/lib/cellumove/pipeline-selection";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import { createTeardownBrief } from "@/lib/cellumove/teardown-brief";
import type {
  AngleRow,
  AppUserRow,
  Json,
  ProductRow,
  ReferenceFormatRow,
  ResearchRow,
  SubAvatarRow,
} from "@/lib/database.types";
import { newId, supabase, unwrap, unwrapOpt } from "@/lib/db";
import { getTeardownDeconstruction } from "@/lib/teardown";

export const CreateScriptProjectSchema = z.object({
  title: z.string().trim().min(2).max(120),
  idea: z.string().trim().min(5).max(4000),
  adNumber: z.string().trim().min(1).max(40),
  creativeName: z.string().trim().min(2).max(120),
  productId: z.string().min(1),
  angleId: z.string().min(1),
  subAvatarId: z.string().nullable().optional(),
  referenceFormatId: z.string().nullable().optional(),
  strategistUserId: z.string().min(1),
  editorUserId: z.string().nullable().optional(),
  format: z.string().trim().min(1).max(80),
  targetDurationSec: z.number().int().min(5).max(600),
  teardownRecordId: z.string().nullable().optional(),
  pipelineRunId: z.string().nullable().optional(),
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
  options: { actor: SessionUser; onProgress?: ScriptGenerationProgressSink },
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
  const [productRaw, angleRaw, strategistRaw, editorRaw, avatarRaw, frameworkRaw, pipelineRunRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", parsed.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", parsed.angleId).maybeSingle()),
    unwrapOpt(await supabase.from("AppUser").select("*").eq("id", parsed.strategistUserId).maybeSingle()),
    parsed.editorUserId ? unwrapOpt(await supabase.from("AppUser").select("*").eq("id", parsed.editorUserId).maybeSingle()) : null,
    parsed.subAvatarId ? unwrapOpt(await supabase.from("SubAvatar").select("*").eq("id", parsed.subAvatarId).maybeSingle()) : null,
    parsed.referenceFormatId ? unwrapOpt(await supabase.from("ReferenceFormat").select("*").eq("id", parsed.referenceFormatId).maybeSingle()) : null,
    parsed.pipelineRunId ? unwrapOpt(await supabase.from("Research").select("*").eq("id", parsed.pipelineRunId).eq("type", "pipeline").maybeSingle()) : null,
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const strategist = strategistRaw as AppUserRow | null;
  const editor = editorRaw as AppUserRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  const framework = frameworkRaw as ReferenceFormatRow | null;
  const pipelineRun = pipelineRunRaw as ResearchRow | null;

  if (!product) throw new Error("Product not found.");
  if (!product.code?.trim()) throw new Error("Assign the product a naming code before creating a script.");
  if (!angle) throw new Error("Angle not found.");
  if (!strategist || strategist.role !== "creative_strategist") throw new Error("Select a valid creative strategist.");
  if (parsed.editorUserId && (!editor || editor.role !== "editor")) throw new Error("Select a valid editor.");
  if (parsed.subAvatarId && (!avatar || avatar.angleId !== angle.id)) throw new Error("The selected avatar does not belong to this angle.");
  if (parsed.referenceFormatId && !framework) throw new Error("Reference format not found.");
  const pipelineDoc = pipelineRun ? parsePipelineRunSelection(pipelineRun.drafts) : null;
  if (parsed.pipelineRunId && (!pipelineRun || !pipelineDoc)) throw new Error("The selected pipeline run is unavailable or invalid.");
  if (pipelineDoc && (!avatar || pipelineDoc.subAvatarId !== avatar.id || pipelineDoc.angleSlug !== angle.slug)) {
    throw new Error("The selected pipeline run does not match this angle and avatar.");
  }
  if (pipelineDoc && pipelineDoc.completedStages === 0) throw new Error("The selected pipeline run has no completed stages yet.");

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
      status: editor ? "assigned" : "available",
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
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: editor ? "Editor assignment saved" : "Added to the unassigned editor queue" });

    await persistScriptSources(projectId, generated.sources, createdAt);
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "success", message: `${generated.sources.length} source receipts saved` });

    unwrap(await supabase.from("ScriptEvent").insert({
      id: newId(), projectId, actorUserId: options.actor.id, eventType: "project_created",
      payload: asJson({
        editorUserId: editor?.id ?? null,
        teardownRecordId: teardown?.id ?? null,
        pipelineRunId: pipelineRun?.id ?? null,
        generation: {
          model: generated.model,
          promptVersion: generated.promptVersion,
          resourceCounts: generated.resourceCounts,
        },
      }),
      createdAt,
    }).select("id").single());
  } catch (error) {
    await supabase.from("ScriptProject").delete().eq("id", projectId);
    const message = error instanceof Error ? error.message : String(error);
    await reportScriptGenerationProgress(progress, { stage: "persistence", level: "error", message: "Saving failed; partial project data was rolled back", detail: message });
    if (/ScriptProject|schema cache|relation/i.test(message)) {
      throw new Error("Script Studio is not installed in the database. Apply migrations/009_script_studio.sql first.");
    }
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
