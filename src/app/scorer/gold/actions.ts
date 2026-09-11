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
  if (!evidence.performanceEvidence?.trim()) throw new Error("Add performance evidence before promoting this script.");
  if (!evidence.scriptText?.trim()) throw new Error("Attach the exact script before promoting this evidence.");
  if (!evidence.angleSlug || !evidence.format) throw new Error("Set the angle and format in the evidence library before promotion.");

  const taxonomy = (taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[];
  const allowedCodes = new Map(taxonomy.map((row) => [row.code, ScorerLayerSchema.parse(row.layer)] as const));
  const normalized = {
    externalId: evidence.externalId || evidence.id,
    title: evidence.title,
    angleSlug: evidence.angleSlug,
    format: evidence.format,
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
