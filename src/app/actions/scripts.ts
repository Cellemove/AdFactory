"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEditor, requireStrategist } from "@/lib/authorization";
import {
  buildScriptDisplayName,
  inspectScriptQuality,
  parseScriptDocument,
  ScriptDocumentSchema,
} from "@/lib/cellumove/script-studio";
import {
  canClaimScript,
  canEditScript,
  canSendScript,
  normalizeScriptWorkflowStatus,
} from "@/lib/cellumove/script-workflow";
import { generateResourceGroundedScript } from "@/lib/cellumove/script-generation.server";
import { createScriptProjectCore, type CreateScriptProjectInput } from "@/lib/cellumove/create-script-project.server";
import { persistScriptSources } from "@/lib/cellumove/script-sources.server";
import type { AngleRow, AppUserRow, Json, ProductRow, ReferenceFormatRow, ScriptAssignmentRow, ScriptProjectRow, SubAvatarRow } from "@/lib/database.types";
import { newId, supabase, unwrap, unwrapOpt } from "@/lib/db";
import { getTeardownDeconstruction, parseTeardownRecord } from "@/lib/teardown";

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function isStatusConstraintError(message: string): boolean {
  return /status.*check|check constraint|violates check constraint/i.test(message);
}

export async function createScriptProject(input: CreateScriptProjectInput): Promise<{ id: string }> {
  const actor = await requireStrategist();
  const result = await createScriptProjectCore(input, { actor });
  revalidatePath("/scripts");
  return result;
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

  const [productRaw, angleRaw, avatarRaw, frameworkRaw, pipelineSourceRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", project.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", project.angleId).maybeSingle()),
    project.subAvatarId
      ? unwrapOpt(await supabase.from("SubAvatar").select("*").eq("id", project.subAvatarId).maybeSingle())
      : null,
    project.referenceFormatId
      ? unwrapOpt(await supabase.from("ReferenceFormat").select("*").eq("id", project.referenceFormatId).maybeSingle())
      : null,
    unwrapOpt(await supabase
      .from("ScriptSource")
      .select("sourceId")
      .eq("projectId", projectId)
      .eq("sourceType", "research")
      .like("title", "Pipeline run · %")
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle()),
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  const framework = frameworkRaw as ReferenceFormatRow | null;
  const pipelineSource = pipelineSourceRaw as { sourceId: string | null } | null;
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
    pipelineRunId: pipelineSource?.sourceId ?? null,
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

export async function sendScriptProjectToEditor(input: {
  projectId: string;
  expectedRevision: number;
  document: z.infer<typeof ScriptDocumentSchema>;
}): Promise<{ revision: number; version: number; status: "ready" }> {
  const actor = await requireStrategist();
  const projectId = z.string().min(1).parse(input.projectId);
  const expectedRevision = z.number().int().nonnegative().parse(input.expectedRevision);
  const document = parseScriptDocument(input.document);
  const [projectRaw, assignmentRaw] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("ScriptAssignment").select("*").eq("projectId", projectId).maybeSingle()),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  const assignment = assignmentRaw as ScriptAssignmentRow | null;
  if (!project) throw new Error("Script project not found.");
  if (project.revision !== expectedRevision) throw new Error("This script changed in another session. Reload before sending it.");
  if (!canSendScript(normalizeScriptWorkflowStatus(project.status, assignment?.status))) {
    throw new Error("This script has already moved to the editor workflow.");
  }
  if (document.product.id !== project.productId || document.angle.id !== project.angleId) {
    throw new Error("The open document does not match this script project. Reload and try again.");
  }
  const blockingIssues = inspectScriptQuality(document).filter((issue) => issue.severity === "error");
  if (blockingIssues.length > 0) {
    throw new Error(`Resolve the script's blocking claim check before sending: ${blockingIssues[0]?.message}`);
  }

  const now = new Date().toISOString();
  const revision = expectedRevision + 1;
  const version = project.currentVersion + 1;
  const projectUpdate = {
    document: asJson(document),
    revision,
    currentVersion: version,
    status: "ready",
    updatedAt: now,
  };
  let updated = await supabase
    .from("ScriptProject")
    .update(projectUpdate)
    .eq("id", projectId)
    .eq("revision", expectedRevision)
    .select("id")
    .maybeSingle();
  if (updated.error && isStatusConstraintError(updated.error.message)) {
    updated = await supabase
      .from("ScriptProject")
      .update({ ...projectUpdate, status: "review" })
      .eq("id", projectId)
      .eq("revision", expectedRevision)
      .select("id")
      .maybeSingle();
  }
  if (updated.error) throw new Error(updated.error.message);
  if (!updated.data) throw new Error("This script changed in another session. Reload before sending it.");

  unwrap(await supabase.from("ScriptVersion").insert({
    id: newId(), projectId, version, document: asJson(document), origin: "assigned",
    changeSummary: project.status === "changes_requested" ? "Updated script sent to editor" : "Script sent to editor",
    createdByUserId: actor.id, createdAt: now,
  }).select("id").single());

  const assignmentValues = {
    editorUserId: project.editorUserId,
    status: "ready",
    deliveryUrl: null,
    reviewNote: null,
    reviewedByUserId: null,
    assignedAt: now,
    claimedAt: null,
    submittedAt: null,
    reviewedAt: null,
    updatedAt: now,
  };
  const legacyReadyStatus = project.editorUserId ? "assigned" : "available";
  if (assignment) {
    let assignmentUpdate = await supabase.from("ScriptAssignment").update(assignmentValues).eq("id", assignment.id);
    if (assignmentUpdate.error && isStatusConstraintError(assignmentUpdate.error.message)) {
      assignmentUpdate = await supabase.from("ScriptAssignment").update({ ...assignmentValues, status: legacyReadyStatus }).eq("id", assignment.id);
    }
    if (assignmentUpdate.error) throw new Error(assignmentUpdate.error.message);
  } else {
    const assignmentInsert = { id: newId(), projectId, ...assignmentValues, createdAt: now };
    let assignmentCreate = await supabase.from("ScriptAssignment").insert(assignmentInsert);
    if (assignmentCreate.error && isStatusConstraintError(assignmentCreate.error.message)) {
      assignmentCreate = await supabase.from("ScriptAssignment").insert({ ...assignmentInsert, status: legacyReadyStatus });
    }
    if (assignmentCreate.error) throw new Error(assignmentCreate.error.message);
  }

  await supabase.from("ScriptEvent").insert({
    id: newId(), projectId, actorUserId: actor.id, eventType: "ready_for_editor",
    payload: asJson({ version, revision, editorUserId: project.editorUserId }), createdAt: now,
  });
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/scripts");
  revalidatePath("/reviews");
  return { revision, version, status: "ready" };
}

export async function assignScriptProjectToEditor(input: {
  projectId: string;
  editorUserId: string;
}): Promise<void> {
  const actor = await requireStrategist();
  const { projectId, editorUserId } = z.object({
    projectId: z.string().min(1),
    editorUserId: z.string().min(1),
  }).parse(input);

  const [projectRaw, assignmentRaw, editorRaw] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("ScriptAssignment").select("*").eq("projectId", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("AppUser").select("*").eq("id", editorUserId).maybeSingle()),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  const assignment = assignmentRaw as ScriptAssignmentRow | null;
  const editor = editorRaw as AppUserRow | null;
  if (!project || !assignment) throw new Error("Script assignment not found.");
  if (!editor || editor.role !== "editor") throw new Error("Choose a valid Editor account.");
  if (project.editorUserId || assignment.editorUserId) throw new Error("This script has already been assigned. Reload the page.");
  if (assignment.status !== "available") throw new Error("This script is not available for assignment in its current state.");

  const [productRaw, angleRaw, strategistRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", project.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", project.angleId).maybeSingle()),
    unwrapOpt(await supabase.from("AppUser").select("*").eq("id", project.strategistUserId).maybeSingle()),
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const strategist = strategistRaw as AppUserRow | null;
  if (!product || !angle || !strategist) throw new Error("Script naming data is incomplete.");
  if (!product.code?.trim()) throw new Error("Assign the product a naming code before assigning this script.");

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
  const assignmentUpdate = await supabase.from("ScriptAssignment").update({
    editorUserId: editor.id,
    status: "assigned",
    assignedAt: now,
    updatedAt: now,
  }).eq("id", assignment.id).eq("status", "available").is("editorUserId", null).select("id").maybeSingle();
  if (assignmentUpdate.error) throw new Error(assignmentUpdate.error.message);
  if (!assignmentUpdate.data) throw new Error("Another editor claimed or received this script first. Reload the page.");

  const projectUpdate = await supabase.from("ScriptProject").update({
    editorUserId: editor.id,
    status: "assigned",
    displayName,
    updatedAt: now,
  }).eq("id", projectId).is("editorUserId", null).select("id").maybeSingle();
  if (projectUpdate.error || !projectUpdate.data) {
    await supabase.from("ScriptAssignment").update({
      editorUserId: null,
      status: "available",
      assignedAt: null,
      updatedAt: new Date().toISOString(),
    }).eq("id", assignment.id).eq("editorUserId", editor.id).eq("status", "assigned");
    throw new Error(projectUpdate.error?.message ?? "The script changed while it was being assigned. Reload and try again.");
  }

  await supabase.from("ScriptEvent").insert({
    id: newId(),
    projectId,
    actorUserId: actor.id,
    eventType: "editor_assigned",
    payload: asJson({ editorUserId: editor.id, editorUsername: editor.username }),
    createdAt: now,
  });
  revalidatePath("/scripts");
  revalidatePath(`/scripts/${projectId}`);
  revalidatePath("/reviews");
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
