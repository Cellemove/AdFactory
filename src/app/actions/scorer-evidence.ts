"use server";

import { revalidatePath } from "next/cache";
import { requireStrategist } from "@/lib/authorization";
import { newId, supabase } from "@/lib/db";
import type { Json } from "@/lib/database.types";
import {
  CreateScorerEvidenceSchema,
  countAlternativeHooks,
  scorerEvidenceHash,
  type CreateScorerEvidenceInput,
} from "@/lib/cellumove/scorer-evidence";
import { extractEvidenceUrls } from "@/lib/cellumove/evidence-library";

export type CreateScorerEvidenceResult =
  | { ok: true; id: string; reused: boolean; warning: string | null }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createScorerEvidenceScript(
  input: CreateScorerEvidenceInput,
): Promise<CreateScorerEvidenceResult> {
  const user = await requireStrategist();
  const validated = CreateScorerEvidenceSchema.safeParse(input);
  if (!validated.success) {
    return {
      ok: false,
      error: "Check the highlighted evidence fields.",
      fieldErrors: validated.error.flatten().fieldErrors,
    };
  }

  const contentHash = scorerEvidenceHash(validated.data);
  const existing = await supabase
    .from("ScriptEvidence")
    .select("id")
    .eq("sourceKey", `manual:${contentHash}`)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data) return { ok: true, id: existing.data.id, reused: true, warning: "This exact evidence script was already stored." };

  const alternativeHookCount = countAlternativeHooks(validated.data.scriptText);
  const capturedAt = new Date().toISOString();
  const id = newId();
  const warning = alternativeHookCount > 1
    ? `${alternativeHookCount} alternative hooks detected. They are preserved as variants and will not count as sequential beats until reviewed.`
    : null;

  const sourceLinks = validated.data.sourceUrl
    ? extractEvidenceUrls([validated.data.sourceUrl], ["Source URL"])
    : [];
  const inserted = await supabase.from("ScriptEvidence").insert({
    id,
    sourceProvider: "manual",
    sourceKey: `manual:${contentHash}`,
    spreadsheetId: null,
    sheetName: null,
    sourceRow: null,
    externalId: validated.data.externalId,
    title: validated.data.title,
    format: validated.data.format,
    avatar: null,
    angleSlug: validated.data.angleSlug,
    marketCode: validated.data.marketCode,
    adDate: null,
    launchedStatus: null,
    sourceStatus: null,
    notes: validated.data.notes,
    metrics: {} as Json,
    sourceLinks: sourceLinks as unknown as Json,
    primarySourceUrl: validated.data.sourceUrl,
    sourceTypes: [...new Set(sourceLinks.map((link) => link.type))] as unknown as Json,
    scriptText: validated.data.scriptText,
    evidenceLevel: validated.data.evidenceLevel,
    performanceEvidence: validated.data.performanceEvidence,
    reviewStatus: "needs_review",
    intent: validated.data.intent,
    contentStatus: "script_available",
    sourceValues: {} as Json,
    overrideFields: ["externalId", "title", "format", "angleSlug", "marketCode", "notes", "primarySourceUrl", "scriptText", "evidenceLevel", "performanceEvidence", "reviewStatus", "intent"] as unknown as Json,
    conflictFields: [] as unknown as Json,
    latestSourceHash: contentHash,
    lastImportedAt: capturedAt,
    createdByUserId: user.id,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  }).select("id").single();
  if (inserted.error) return { ok: false, error: inserted.error.message };
  const revision = await supabase.from("ScriptEvidenceRevision").insert({
    id: newId(),
    evidenceId: id,
    spreadsheetId: null,
    sheetName: "Manual intake",
    rowNumber: null,
    rawHeaders: ["payload"] as unknown as Json,
    rawCells: [{
      ...validated.data,
      alternativeHookCount,
      contentHash,
      capturedAt,
      capturedByUserId: user.id,
    }] as unknown as Json,
    sourceHash: contentHash,
    extractedSourceUrls: sourceLinks as unknown as Json,
    importedAt: capturedAt,
  });
  if (revision.error) return { ok: false, error: revision.error.message };

  revalidatePath("/scorer");
  revalidatePath("/scorer/evidence");
  return { ok: true, id, reused: false, warning };
}
