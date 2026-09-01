"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEditor, requireStrategist } from "@/lib/authorization";
import {
  buildScriptDisplayName,
  createInitialScriptDocument,
  parseScriptDocument,
  ScriptDocumentSchema,
} from "@/lib/cellumove/script-studio";
import {
  generateResourceGroundedScript,
  type GeneratedScriptSource,
} from "@/lib/cellumove/script-generation.server";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import { createTeardownBrief } from "@/lib/cellumove/teardown-brief";
import type { AngleRow, AppUserRow, Json, ProductRow, ReferenceFormatRow, ScriptAssignmentRow, ScriptProjectRow, SubAvatarRow } from "@/lib/database.types";
import { newId, supabase, unwrap, unwrapOpt } from "@/lib/db";
import { getTeardownDeconstruction, parseTeardownRecord } from "@/lib/teardown";

const CreateScriptProjectSchema = z.object({
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
});

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseBeats(value: string): ReferenceFormatBeat[] {
  return z.array(z.object({ label: z.string(), time: z.string(), note: z.string() })).parse(JSON.parse(value));
}

async function persistScriptSources(
  projectId: string,
  sources: GeneratedScriptSource[],
  createdAt: string,
): Promise<void> {
  if (!sources.length) return;
  const existing = unwrap(
    await supabase.from("ScriptSource").select("sourceType, sourceId, title").eq("projectId", projectId),
  ) as Array<{ sourceType: string; sourceId: string | null; title: string }>;
  const existingKeys = new Set(existing.map((source) => `${source.sourceType}:${source.sourceId ?? ""}:${source.title}`));
  const pending = sources.filter((source) => !existingKeys.has(`${source.sourceType}:${source.sourceId ?? ""}:${source.title}`));
  if (!pending.length) return;
  unwrap(await supabase.from("ScriptSource").insert(pending.map((source) => ({
    id: newId(),
    projectId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    title: source.title,
    url: source.url,
    snapshot: asJson(source.snapshot),
    createdAt,
  }))).select("id"));
}

export async function createScriptProject(input: z.infer<typeof CreateScriptProjectSchema>): Promise<{ id: string }> {
  const actor = await requireStrategist();
  const parsed = CreateScriptProjectSchema.parse(input);

  const [productRaw, angleRaw, strategistRaw, editorRaw, avatarRaw, frameworkRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", parsed.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", parsed.angleId).maybeSingle()),
    unwrapOpt(await supabase.from("AppUser").select("*").eq("id", parsed.strategistUserId).maybeSingle()),
    parsed.editorUserId ? unwrapOpt(await supabase.from("AppUser").select("*").eq("id", parsed.editorUserId).maybeSingle()) : null,
    parsed.subAvatarId ? unwrapOpt(await supabase.from("SubAvatar").select("*").eq("id", parsed.subAvatarId).maybeSingle()) : null,
    parsed.referenceFormatId ? unwrapOpt(await supabase.from("ReferenceFormat").select("*").eq("id", parsed.referenceFormatId).maybeSingle()) : null,
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const strategist = strategistRaw as AppUserRow | null;
  const editor = editorRaw as AppUserRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  const framework = frameworkRaw as ReferenceFormatRow | null;

  if (!product) throw new Error("Product not found.");
  if (!product.code?.trim()) throw new Error("Assign the product a naming code before creating a script.");
  if (!angle) throw new Error("Angle not found.");
  if (!strategist || strategist.role !== "creative_strategist") throw new Error("Select a valid creative strategist.");
  if (parsed.editorUserId && (!editor || editor.role !== "editor")) throw new Error("Select a valid editor.");
  if (parsed.subAvatarId && (!avatar || avatar.angleId !== angle.id)) throw new Error("The selected avatar does not belong to this angle.");
  if (parsed.referenceFormatId && !framework) throw new Error("Reference format not found.");

  const teardown = parsed.teardownRecordId
    ? await getTeardownDeconstruction(parsed.teardownRecordId)
    : null;
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
  });
  const document = generated.document;

  const projectId = newId();
  try {
    unwrap(await supabase.from("ScriptProject").insert({
      id: projectId,
      title: parsed.title,
      status: editor ? "assigned" : "available",
      strategistUserId: strategist.id,
      editorUserId: editor?.id ?? null,
      createdByUserId: actor.id,
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

    unwrap(await supabase.from("ScriptVersion").insert({
      id: newId(), projectId, version: 1, document: asJson(document), origin: "generated",
      changeSummary: "AI-generated resource-grounded first draft", model: generated.model,
      promptVersion: generated.promptVersion, createdByUserId: actor.id, createdAt,
    }).select("id").single());

    unwrap(await supabase.from("ScriptAssignment").insert({
      id: newId(), projectId, editorUserId: editor?.id ?? null,
      status: editor ? "assigned" : "available", assignedAt: editor ? createdAt : null,
      createdAt, updatedAt: createdAt,
    }).select("id").single());

    await persistScriptSources(projectId, generated.sources, createdAt);

    unwrap(await supabase.from("ScriptEvent").insert({
      id: newId(), projectId, actorUserId: actor.id, eventType: "project_created",
      payload: asJson({
        editorUserId: editor?.id ?? null,
        teardownRecordId: teardown?.id ?? null,
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
    if (/ScriptProject|schema cache|relation/i.test(message)) {
      throw new Error("Script Studio is not installed in the database. Apply migrations/009_script_studio.sql first.");
    }
    throw error;
  }

  revalidatePath("/scripts");
  return { id: projectId };
}

export async function generateScriptProjectDraft(input: {
  projectId: string;
  expectedRevision: number;
  document: z.infer<typeof ScriptDocumentSchema>;
}): Promise<{ document: z.infer<typeof ScriptDocumentSchema>; revision: number; version: number }> {
  const actor = await requireStrategist();
  const projectId = z.string().min(1).parse(input.projectId);
  const expectedRevision = z.number().int().nonnegative().parse(input.expectedRevision);
  const scaffold = parseScriptDocument(input.document);
  const project = unwrapOpt(
    await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle(),
  ) as ScriptProjectRow | null;
  if (!project) throw new Error("Script project not found.");
  if (project.revision !== expectedRevision) throw new Error("This script changed in another session. Reload before generating again.");
  if (!canEditScript(normalizeScriptWorkflowStatus(project.status))) {
    throw new Error("This script is frozen for the editor. Request changes before editing the handed-off version.");
  }

  const [productRaw, angleRaw, avatarRaw, frameworkRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", project.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", project.angleId).maybeSingle()),
    project.subAvatarId
      ? unwrapOpt(await supabase.from("SubAvatar").select("*").eq("id", project.subAvatarId).maybeSingle())
      : null,
    project.referenceFormatId
      ? unwrapOpt(await supabase.from("ReferenceFormat").select("*").eq("id", project.referenceFormatId).maybeSingle())
      : null,
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  const framework = frameworkRaw as ReferenceFormatRow | null;
  if (!product || !angle) throw new Error("This script's product or angle is missing.");
  if (scaffold.product.id !== product.id || scaffold.angle.id !== angle.id) {
    throw new Error("The open document does not match this script project. Reload and try again.");
  }

  let teardown = parseTeardownRecord(project.teardownSnapshot);
  if (!teardown && project.teardownRecordId) {
    teardown = await getTeardownDeconstruction(project.teardownRecordId);
  }
  const generated = await generateResourceGroundedScript({
    scaffold,
    idea: project.idea,
    product,
    angle,
    avatar,
    framework,
    teardown,
    preserveLocked: true,
  });

  const now = new Date().toISOString();
  const revision = expectedRevision + 1;
  const version = project.currentVersion + 1;
  const updated = await supabase
    .from("ScriptProject")
    .update({ document: asJson(generated.document), revision, currentVersion: version, updatedAt: now })
    .eq("id", projectId)
    .eq("revision", expectedRevision)
    .select("id")
    .maybeSingle();
  if (updated.error) throw new Error(updated.error.message);
  if (!updated.data) throw new Error("This script changed in another session. Reload before generating again.");

  unwrap(await supabase.from("ScriptVersion").insert({
    id: newId(), projectId, version, document: asJson(generated.document), origin: "generated",
    changeSummary: "AI regenerated the complete resource-grounded draft", model: generated.model,
    promptVersion: generated.promptVersion, createdByUserId: actor.id, createdAt: now,
  }).select("id").single());
  try {
    await persistScriptSources(projectId, generated.sources, now);
  } catch (error) {
    console.warn(`AI draft saved, but source traceability could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await supabase.from("ScriptEvent").insert({
    id: newId(), projectId, actorUserId: actor.id, eventType: "ai_draft_generated",
    payload: asJson({
      revision,
      version,
      model: generated.model,
      promptVersion: generated.promptVersion,
      resourceCounts: generated.resourceCounts,
    }),
    createdAt: now,
  });
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/scripts");
  return { document: generated.document, revision, version };
}

export async function saveScriptDocument(input: {
  projectId: string;
  expectedRevision: number;
  document: z.infer<typeof ScriptDocumentSchema>;
}): Promise<{ revision: number }> {
  const actor = await requireStrategist();
  const projectId = z.string().min(1).parse(input.projectId);
  const expectedRevision = z.number().int().nonnegative().parse(input.expectedRevision);
  const document = parseScriptDocument(input.document);
  const project = unwrapOpt(
    await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle(),
  ) as ScriptProjectRow | null;
  if (!project) throw new Error("Script project not found.");
  if (!canEditScript(normalizeScriptWorkflowStatus(project.status))) {
    throw new Error("This script is frozen for the editor. Request changes before editing the handed-off version.");
  }
  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;

  const response = await supabase
    .from("ScriptProject")
    .update({ document: asJson(document), revision: nextRevision, updatedAt: now })
    .eq("id", projectId)
    .eq("revision", expectedRevision)
    .select("id")
    .maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error("This script changed in another session. Reload before saving again.");

  await supabase.from("ScriptEvent").insert({
    id: newId(), projectId, actorUserId: actor.id, eventType: "document_saved",
    payload: asJson({ revision: nextRevision }), createdAt: now,
  });
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/scripts");
  return { revision: nextRevision };
}

export async function snapshotScriptProject(input: { projectId: string; changeSummary: string }): Promise<{ version: number }> {
  const actor = await requireStrategist();
  const projectId = z.string().min(1).parse(input.projectId);
  const changeSummary = z.string().trim().min(2).max(240).parse(input.changeSummary);
  const project = unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()) as ScriptProjectRow | null;
  if (!project) throw new Error("Script project not found.");
  if (!canEditScript(normalizeScriptWorkflowStatus(project.status))) {
    throw new Error("This script is frozen for the editor. Request changes before creating another version.");
  }
  const version = project.currentVersion + 1;
  const now = new Date().toISOString();

  unwrap(await supabase.from("ScriptVersion").insert({
    id: newId(), projectId, version, document: project.document, origin: "manual",
    changeSummary, createdByUserId: actor.id, createdAt: now,
  }).select("id").single());
  const { error } = await supabase.from("ScriptProject").update({ currentVersion: version, updatedAt: now }).eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/scripts/${projectId}`);
  return { version };
}

export async function claimScriptProject(projectIdInput: string): Promise<void> {
  const editor = await requireEditor();
  const projectId = z.string().min(1).parse(projectIdInput);
  const [projectRaw, assignmentRaw] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("ScriptAssignment").select("*").eq("projectId", projectId).maybeSingle()),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  const assignment = assignmentRaw as ScriptAssignmentRow | null;
  if (!project || !assignment) throw new Error("Script assignment not found.");
  if (assignment.editorUserId && assignment.editorUserId !== editor.id) throw new Error("This script is assigned to another editor.");
  if (assignment.status === "claimed" && assignment.editorUserId === editor.id) return;
  if (!canClaimScript(normalizeScriptWorkflowStatus(project.status, assignment.status))) {
    throw new Error("This script is not ready to be claimed.");
  }

  const [productRaw, angleRaw, strategistRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", project.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", project.angleId).maybeSingle()),
    unwrapOpt(await supabase.from("AppUser").select("*").eq("id", project.strategistUserId).maybeSingle()),
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const strategist = strategistRaw as AppUserRow | null;
  if (!product || !angle || !strategist) throw new Error("Script naming data is incomplete.");
  if (!product.code?.trim()) throw new Error("Assign the product a naming code before this script can be claimed.");

  const now = new Date().toISOString();
  const displayName = buildScriptDisplayName({
    strategist: strategist.shortCode || strategist.username,
    editor: editor.username,
    adNumber: project.adNumber,
    angle: angle.name,
    creativeName: project.creativeName,
    productCode: product.code,
    createdAt: new Date(project.createdAt),
  });
  const claimed = await supabase.from("ScriptAssignment").update({
    editorUserId: editor.id, status: "claimed", claimedAt: now, updatedAt: now,
  }).eq("id", assignment.id).eq("status", assignment.status).select("id").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) throw new Error("Another editor claimed this script first.");
  let projectClaim = await supabase.from("ScriptProject").update({ editorUserId: editor.id, status: "claimed", displayName, updatedAt: now }).eq("id", projectId);
  if (projectClaim.error && isStatusConstraintError(projectClaim.error.message)) {
    projectClaim = await supabase.from("ScriptProject").update({ editorUserId: editor.id, status: "assigned", displayName, updatedAt: now }).eq("id", projectId);
  }
  if (projectClaim.error) throw new Error(projectClaim.error.message);
  await supabase.from("ScriptEvent").insert({ id: newId(), projectId, actorUserId: editor.id, eventType: "editor_claimed", payload: {}, createdAt: now });
  revalidatePath("/reviews");
  revalidatePath("/scripts");
}

export async function submitScriptDelivery(projectIdInput: string, deliveryUrlInput: string): Promise<void> {
  const editor = await requireEditor();
  const projectId = z.string().min(1).parse(projectIdInput);
  const deliveryUrl = z.string().trim().url("Enter a complete delivery URL.").max(2000).parse(deliveryUrlInput);
  const [projectRaw, assignmentRaw] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("ScriptAssignment").select("*").eq("projectId", projectId).maybeSingle()),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  const assignment = assignmentRaw as ScriptAssignmentRow | null;
  if (!project || !assignment) throw new Error("Script assignment not found.");
  if (assignment.editorUserId !== editor.id) throw new Error("This script is not assigned to you.");
  if (!["claimed", "changes_requested"].includes(assignment.status)) throw new Error("Claim this script before submitting a delivery.");

  const now = new Date().toISOString();
  const assignmentUpdate = await supabase.from("ScriptAssignment").update({ deliveryUrl, status: "submitted", submittedAt: now, updatedAt: now }).eq("id", assignment.id);
  if (assignmentUpdate.error) throw new Error(assignmentUpdate.error.message);
  const projectUpdate = await supabase.from("ScriptProject").update({ status: "submitted", updatedAt: now }).eq("id", projectId);
  if (projectUpdate.error) throw new Error(projectUpdate.error.message);
  await supabase.from("ScriptEvent").insert({ id: newId(), projectId, actorUserId: editor.id, eventType: "delivery_submitted", payload: asJson({ deliveryUrl, handoffVersion: project.currentVersion }), createdAt: now });
  revalidatePath("/reviews");
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/scripts");
}

export async function reviewScriptDelivery(projectIdInput: string, noteInput: string, statusInput: string): Promise<void> {
  const strategist = await requireStrategist();
  const projectId = z.string().min(1).parse(projectIdInput);
  const note = z.string().trim().max(4000).parse(noteInput);
  const status = z.enum(["changes_requested", "approved"]).parse(statusInput);
  const assignment = unwrapOpt(await supabase.from("ScriptAssignment").select("*").eq("projectId", projectId).maybeSingle()) as ScriptAssignmentRow | null;
  if (!assignment) throw new Error("Script assignment not found.");
  if (assignment.status !== "submitted") throw new Error("The editor must submit a delivery before it can be reviewed.");
  const now = new Date().toISOString();
  const assignmentUpdate = await supabase.from("ScriptAssignment").update({ status, reviewNote: note || null, reviewedByUserId: strategist.id, reviewedAt: now, updatedAt: now }).eq("id", assignment.id);
  if (assignmentUpdate.error) throw new Error(assignmentUpdate.error.message);
  const projectUpdate = await supabase.from("ScriptProject").update({ status, updatedAt: now }).eq("id", projectId);
  if (projectUpdate.error) throw new Error(projectUpdate.error.message);
  await supabase.from("ScriptEvent").insert({ id: newId(), projectId, actorUserId: strategist.id, eventType: status, payload: asJson({ note }), createdAt: now });
  revalidatePath("/reviews");
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/scripts");
}
