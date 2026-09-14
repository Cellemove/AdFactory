"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStrategist } from "@/lib/authorization";
import { newId, supabase } from "@/lib/db";
import type { CopyTaxonomyCodeRow, GoldAdRow, ScriptEvidenceRow } from "@/lib/database.types";
import { validateGoldSetImport } from "@/lib/cellumove/gold-set-import";
import { SCORER_BASELINE_VERSION, SCORER_TAXONOMY_VERSION, ScorerLayerSchema } from "@/lib/cellumove/script-scorer";

const OptionalNumber = z.number().nonnegative().nullable().optional();
const PromoteSchema = z.object({
  evidenceId: z.string().min(1),
  // Typed on the gold page when the evidence row is missing them; persisted
  // back to the evidence record as overrides.
  angleSlug: z.string().trim().min(1).nullable().optional(),
  format: z.string().trim().min(1).max(100).nullable().optional(),
  durationSec: z.number().positive().max(600).nullable().optional(),
  beats: z.array(z.object({
    code: z.string().min(1),
    evidenceQuote: z.string().min(1),
    startSec: OptionalNumber,
    endSec: OptionalNumber,
    otherExplanation: z.string().trim().nullable().optional(),
  })).min(1),
});

function revalidateGoldPages() {
  revalidatePath("/scorer");
  revalidatePath("/scorer/gold");
}

const ScriptEditSchema = z.object({
  evidenceId: z.string().min(1),
  scriptText: z.string().trim().min(20, "Paste the complete script, not only its title.").max(200_000),
});

/**
 * Edit a candidate's script from the gold page (e.g. repairing timestamp lines
 * that got flattened into the prose). Saved as an override so sheet re-imports
 * never clobber the fix.
 */
export async function updateGoldCandidateScript(rawInput: z.infer<typeof ScriptEditSchema>) {
  await requireStrategist();
  const input = ScriptEditSchema.parse(rawInput);
  const current = await supabase.from("ScriptEvidence").select("overrideFields").eq("id", input.evidenceId).single();
  if (current.error) throw new Error(current.error.message);
  const overrides = new Set(Array.isArray(current.data.overrideFields) ? (current.data.overrideFields as unknown as string[]) : []);
  overrides.add("scriptText");
  const update = await supabase
    .from("ScriptEvidence")
    .update({
      scriptText: input.scriptText,
      overrideFields: [...overrides] as unknown as ScriptEvidenceRow["overrideFields"],
      contentStatus: "script_available",
      updatedAt: new Date().toISOString(),
    })
    .eq("id", input.evidenceId);
  if (update.error) throw new Error(update.error.message);
  revalidateGoldPages();
  revalidatePath("/scorer/evidence");
}

export async function promoteEvidenceToGold(rawInput: z.infer<typeof PromoteSchema>) {
  await requireStrategist();
  const input = PromoteSchema.parse(rawInput);
  const [evidenceResult, taxonomyResult] = await Promise.all([
    supabase.from("ScriptEvidence").select("*").eq("id", input.evidenceId).single(),
    supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION),
  ]);
  if (evidenceResult.error) throw new Error(evidenceResult.error.message);
  if (taxonomyResult.error) throw new Error(taxonomyResult.error.message);
  const evidence = evidenceResult.data as ScriptEvidenceRow;
  if (evidence.evidenceLevel !== "verified_winner" || evidence.reviewStatus !== "approved") {
    throw new Error("Only approved evidence marked verified winner can enter the gold baseline.");
  }
  if (!evidence.scriptText?.trim()) throw new Error("Attach the exact script before promoting this evidence.");
  const angleSlug = input.angleSlug?.trim() || evidence.angleSlug;
  const format = input.format?.trim() || evidence.format;
  if (!angleSlug || !format) throw new Error("Set the angle and format before promotion.");

  // Persist gold-page edits onto the evidence row as overrides, so the library
  // shows the same values and sheet re-imports don't clobber them.
  if (angleSlug !== evidence.angleSlug || format !== evidence.format) {
    const overrides = new Set(Array.isArray(evidence.overrideFields) ? (evidence.overrideFields as unknown as string[]) : []);
    overrides.add("angleSlug");
    overrides.add("format");
    const patch = await supabase
      .from("ScriptEvidence")
      .update({ angleSlug, format, overrideFields: [...overrides] as unknown as ScriptEvidenceRow["overrideFields"], updatedAt: new Date().toISOString() })
      .eq("id", evidence.id);
    if (patch.error) throw new Error(patch.error.message);
  }

  const taxonomy = (taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[];
  const allowedCodes = new Map(taxonomy.map((row) => [row.code, ScorerLayerSchema.parse(row.layer)] as const));
  const normalized = {
    externalId: evidence.externalId || evidence.id,
    title: evidence.title,
    angleSlug,
    format,
    marketCode: evidence.marketCode,
    durationSec: input.durationSec ?? null,
    scriptText: evidence.scriptText,
    beats: input.beats.map((beat, orderIndex) => ({
      orderIndex,
      code: beat.code,
      layer: allowedCodes.get(beat.code) ?? "OTHER" as const,
      startSec: beat.startSec ?? null,
      endSec: beat.endSec ?? null,
      evidenceQuote: beat.evidenceQuote,
      otherExplanation: beat.otherExplanation || null,
    })),
  };
  const report = validateGoldSetImport([normalized], allowedCodes);
  if (report.rejected.length) throw new Error(report.rejected[0]?.errors.join(" ") || "Gold evidence validation failed.");
  const ad = report.accepted[0]!;

  const bySource = await supabase.from("GoldAd").select("*").eq("sourceEvidenceId", evidence.id).maybeSingle();
  if (bySource.error) throw new Error(bySource.error.message);
  let existing = bySource.data as GoldAdRow | null;
  if (!existing) {
    const byExternalId = await supabase.from("GoldAd").select("*").eq("baselineVersion", SCORER_BASELINE_VERSION).eq("externalId", ad.externalId).maybeSingle();
    if (byExternalId.error) throw new Error(byExternalId.error.message);
    existing = byExternalId.data as GoldAdRow | null;
    if (existing?.sourceEvidenceId && existing.sourceEvidenceId !== evidence.id) throw new Error("That external ID is already linked to a different evidence record.");
  }
  const adId = existing?.id ?? newId();
  const adPayload = {
    externalId: ad.externalId,
    title: ad.title,
    angleSlug: ad.angleSlug,
    format: ad.format,
    marketCode: ad.marketCode?.toUpperCase() ?? null,
    durationSec: ad.durationSec ?? null,
    scriptText: ad.scriptText,
    baselineVersion: SCORER_BASELINE_VERSION,
    taxonomyVersion: SCORER_TAXONOMY_VERSION,
    sourceEvidenceId: evidence.id,
  };
  const adWrite = existing
    ? await supabase.from("GoldAd").update(adPayload).eq("id", adId)
    : await supabase.from("GoldAd").insert({ id: adId, ...adPayload });
  if (adWrite.error) throw new Error(adWrite.error.message);

  const beatRows = ad.beats.map((beat) => ({
    id: `gb_${createHash("sha256").update(`${SCORER_BASELINE_VERSION}:${ad.externalId}:${beat.orderIndex}`).digest("hex").slice(0, 24)}`,
    goldAdId: adId,
    taxonomyVersion: SCORER_TAXONOMY_VERSION,
    orderIndex: beat.orderIndex,
    layer: beat.layer,
    code: beat.code,
    startSec: beat.startSec ?? null,
    endSec: beat.endSec ?? null,
    evidenceQuote: beat.evidenceQuote,
    otherExplanation: beat.otherExplanation ?? null,
  }));
  const beatWrite = await supabase.from("GoldBeat").upsert(beatRows, { onConflict: "goldAdId,orderIndex" });
  if (beatWrite.error) throw new Error(beatWrite.error.message);
  const existingBeats = await supabase.from("GoldBeat").select("id").eq("goldAdId", adId);
  if (existingBeats.error) throw new Error(existingBeats.error.message);
  const activeIds = new Set(beatRows.map((beat) => beat.id));
  const staleIds = (existingBeats.data ?? []).map((beat) => beat.id).filter((id) => !activeIds.has(id));
  if (staleIds.length) {
    const removeStale = await supabase.from("GoldBeat").delete().in("id", staleIds);
    if (removeStale.error) throw new Error(removeStale.error.message);
  }
  revalidateGoldPages();
}

export async function removeGoldAd(id: string) {
  await requireStrategist();
  const parsedId = z.string().min(1).parse(id);
  const result = await supabase.from("GoldAd").delete().eq("id", parsedId);
  if (result.error) throw new Error(result.error.message);
  revalidateGoldPages();
}
