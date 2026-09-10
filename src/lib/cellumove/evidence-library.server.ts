import "server-only";

import { supabase } from "@/lib/db";
import type { Json, ScriptEvidenceRow } from "@/lib/database.types";
import {
  getJsonStringArray,
  type EditableEvidenceField,
  type EvidencePatch,
} from "@/lib/cellumove/evidence-library";

export class EvidenceConflictError extends Error {}
export class EvidenceValidationError extends Error {}

export async function getEvidenceRecord(id: string): Promise<ScriptEvidenceRow | null> {
  const result = await supabase.from("ScriptEvidence").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateEvidenceRecord(
  id: string,
  expectedUpdatedAt: string,
  patch: EvidencePatch,
): Promise<ScriptEvidenceRow> {
  const current = await getEvidenceRecord(id);
  if (!current) throw new EvidenceValidationError("Evidence record not found.");
  if (current.updatedAt !== expectedUpdatedAt) {
    throw new EvidenceConflictError("This entry changed after you opened it. Reload it before saving.");
  }
  const next = applyEvidencePatch(current, patch);
  const result = await supabase
    .from("ScriptEvidence")
    .update(next)
    .eq("id", id)
    .eq("updatedAt", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new EvidenceConflictError("This entry changed while it was being saved. Reload and try again.");
  return result.data;
}

export async function resetEvidenceField(
  id: string,
  expectedUpdatedAt: string,
  field: EditableEvidenceField,
): Promise<ScriptEvidenceRow> {
  const current = await getEvidenceRecord(id);
  if (!current) throw new EvidenceValidationError("Evidence record not found.");
  if (current.updatedAt !== expectedUpdatedAt) throw new EvidenceConflictError("This entry changed after you opened it. Reload it before resetting the field.");
  const sourceValues = asRecord(current.sourceValues);
  const restored = Object.prototype.hasOwnProperty.call(sourceValues, field)
    ? sourceValues[field]
    : resetDefault(field);
  const next = applyEvidencePatch(current, { [field]: restored } as EvidencePatch);
  const overrides = new Set(getJsonStringArray(next.overrideFields ?? current.overrideFields));
  const conflicts = new Set(getJsonStringArray(next.conflictFields ?? current.conflictFields));
  overrides.delete(field);
  conflicts.delete(field);
  const result = await supabase
    .from("ScriptEvidence")
    .update({
      ...next,
      overrideFields: [...overrides] as unknown as Json,
      conflictFields: [...conflicts] as unknown as Json,
    })
    .eq("id", id)
    .eq("updatedAt", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new EvidenceConflictError("This entry changed while it was being reset. Reload and try again.");
  return result.data;
}

export async function bulkUpdateEvidence(ids: string[], patch: EvidencePatch): Promise<ScriptEvidenceRow[]> {
  const result = await supabase.from("ScriptEvidence").select("*").in("id", ids);
  if (result.error) throw new Error(result.error.message);
  const currentRows = result.data ?? [];
  if (currentRows.length !== ids.length) throw new EvidenceValidationError("One or more selected evidence records no longer exist.");
  const updatedRows = currentRows.map((row) => ({ ...row, ...applyEvidencePatch(row, patch) }));
  const update = await supabase.from("ScriptEvidence").upsert(updatedRows, { onConflict: "id" }).select("*");
  if (update.error) throw new Error(update.error.message);
  return update.data ?? [];
}

function applyEvidencePatch(current: ScriptEvidenceRow, patch: EvidencePatch): Partial<ScriptEvidenceRow> {
  const nextLevel = patch.evidenceLevel ?? current.evidenceLevel;
  const nextPerformance = Object.prototype.hasOwnProperty.call(patch, "performanceEvidence")
    ? patch.performanceEvidence
    : current.performanceEvidence;
  if (nextLevel === "verified_winner" && !nextPerformance?.trim()) {
    throw new EvidenceValidationError("Verified winner requires explicit performance evidence.");
  }
  const sourceValues = asRecord(current.sourceValues);
  const overrides = new Set(getJsonStringArray(current.overrideFields));
  const conflicts = new Set(getJsonStringArray(current.conflictFields));
  Object.entries(patch).forEach(([field, value]) => {
    if (Object.prototype.hasOwnProperty.call(sourceValues, field) && jsonEqual(value as Json, sourceValues[field])) {
      overrides.delete(field);
      conflicts.delete(field);
    } else {
      overrides.add(field);
      // Explicitly saving an override means "Keep my edit" for a source conflict.
      conflicts.delete(field);
    }
  });
  const scriptText = Object.prototype.hasOwnProperty.call(patch, "scriptText") ? patch.scriptText : current.scriptText;
  return {
    ...patch,
    contentStatus: scriptText?.trim() ? "script_available" : hasMilanote(current) ? "enrichment_pending" : "source_only",
    overrideFields: [...overrides] as unknown as Json,
    conflictFields: [...conflicts] as unknown as Json,
    updatedAt: new Date().toISOString(),
  };
}

function resetDefault(field: EditableEvidenceField): Json {
  if (field === "title") return "Untitled evidence";
  if (field === "metrics") return {};
  if (field === "evidenceLevel") return "observed";
  if (field === "reviewStatus") return "unreviewed";
  if (field === "intent") return "structural_candidate";
  return null;
}

function hasMilanote(current: ScriptEvidenceRow): boolean {
  return getJsonStringArray(current.sourceTypes).includes("milanote");
}

function asRecord(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

function jsonEqual(left: Json | undefined, right: Json | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
