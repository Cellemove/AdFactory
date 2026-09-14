"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStrategist } from "@/lib/authorization";
import { newId, supabase } from "@/lib/db";

const StatusSchema = z.enum(["draft", "approved", "retired"]);
const OptionalUrl = z.string().trim().url("Enter a complete source URL.").max(2_000).nullable().optional();
const CommonSchema = z.object({
  productId: z.string().min(1),
  marketCode: z.string().trim().max(12).nullable().optional(),
  statement: z.string().trim().min(3).max(2_000),
  sourceUrl: OptionalUrl,
  status: StatusSchema,
});

const CreateFactSchema = CommonSchema.extend({ factType: z.string().trim().min(1).max(80) });
const CreateOfferSchema = CommonSchema.extend({
  offerType: z.string().trim().min(1).max(80),
  validFrom: z.string().trim().nullable().optional(),
  validUntil: z.string().trim().nullable().optional(),
});
const UpdateEvidenceSchema = CommonSchema.omit({ productId: true }).extend({
  kind: z.enum(["fact", "offer"]),
  id: z.string().min(1),
  type: z.string().trim().min(1).max(80),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  validFrom: z.string().trim().nullable().optional(),
  validUntil: z.string().trim().nullable().optional(),
});

function normalizeStatement(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function approvedAudit(status: z.infer<typeof StatusSchema>, userId: string) {
  return status === "approved"
    ? { approvedByUserId: userId, approvedAt: new Date().toISOString() }
    : { approvedByUserId: null, approvedAt: null };
}

function requireApprovalSource(status: z.infer<typeof StatusSchema>, sourceUrl: string | null | undefined) {
  if (status === "approved" && !sourceUrl?.trim()) {
    throw new Error("Approved evidence requires a source URL. Save it as draft until the source is available.");
  }
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid date: ${value}`);
  return new Date(parsed).toISOString();
}

function revalidateEvidencePages() {
  revalidatePath("/scorer");
  revalidatePath("/scorer/facts");
}

export async function createBrandFact(rawInput: z.infer<typeof CreateFactSchema>) {
  const actor = await requireStrategist();
  const input = CreateFactSchema.parse(rawInput);
  requireApprovalSource(input.status, input.sourceUrl);
  const now = new Date().toISOString();
  const result = await supabase.from("BrandFact").insert({
    id: newId(),
    productId: input.productId,
    marketCode: input.marketCode?.toUpperCase() || null,
    factType: input.factType,
    statement: input.statement,
    normalizedStatement: normalizeStatement(input.statement),
    sourceUrl: input.sourceUrl || null,
    status: input.status,
    ...approvedAudit(input.status, actor.id),
    createdAt: now,
    updatedAt: now,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateEvidencePages();
}

export async function createProductOffer(rawInput: z.infer<typeof CreateOfferSchema>) {
  const actor = await requireStrategist();
  const input = CreateOfferSchema.parse(rawInput);
  requireApprovalSource(input.status, input.sourceUrl);
  const validFrom = isoDate(input.validFrom);
  const validUntil = isoDate(input.validUntil);
  if (validFrom && validUntil && validFrom > validUntil) throw new Error("Offer end date must be after its start date.");
  const now = new Date().toISOString();
  const result = await supabase.from("ProductOffer").insert({
    id: newId(),
    productId: input.productId,
    marketCode: input.marketCode?.toUpperCase() || null,
    offerType: input.offerType,
    statement: input.statement,
    sourceUrl: input.sourceUrl || null,
    status: input.status,
    validFrom,
    validUntil,
    ...approvedAudit(input.status, actor.id),
    createdAt: now,
    updatedAt: now,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateEvidencePages();
}

export async function setFactOrOfferStatus(rawInput: { kind: "fact" | "offer"; id: string; status: string }) {
  const actor = await requireStrategist();
  const input = z.object({ kind: z.enum(["fact", "offer"]), id: z.string().min(1), status: StatusSchema }).parse(rawInput);
  const table = input.kind === "fact" ? "BrandFact" : "ProductOffer";
  const current = await supabase.from(table).select("sourceUrl").eq("id", input.id).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error("Evidence record not found.");
  requireApprovalSource(input.status, current.data.sourceUrl);
  const result = await supabase.from(table).update({
    status: input.status,
    ...approvedAudit(input.status, actor.id),
    updatedAt: new Date().toISOString(),
  }).eq("id", input.id);
  if (result.error) throw new Error(result.error.message);
  revalidateEvidencePages();
}

export async function updateFactOrOffer(rawInput: z.infer<typeof UpdateEvidenceSchema>) {
  const actor = await requireStrategist();
  const input = UpdateEvidenceSchema.parse(rawInput);
  requireApprovalSource(input.status, input.sourceUrl);
  const validFrom = input.kind === "offer" ? isoDate(input.validFrom) : null;
  const validUntil = input.kind === "offer" ? isoDate(input.validUntil) : null;
  if (validFrom && validUntil && validFrom > validUntil) throw new Error("Offer end date must be after its start date.");
  const now = new Date().toISOString();
  const commonUpdate = {
    marketCode: input.marketCode?.toUpperCase() || null,
    statement: input.statement,
    sourceUrl: input.sourceUrl || null,
    status: input.status,
    ...approvedAudit(input.status, actor.id),
    updatedAt: now,
  };
  const result = input.kind === "fact"
    ? await supabase.from("BrandFact").update({
        ...commonUpdate,
        factType: input.type,
        normalizedStatement: normalizeStatement(input.statement),
      }).eq("id", input.id).eq("updatedAt", input.expectedUpdatedAt).select("id").maybeSingle()
    : await supabase.from("ProductOffer").update({
        ...commonUpdate,
        offerType: input.type,
        validFrom,
        validUntil,
      }).eq("id", input.id).eq("updatedAt", input.expectedUpdatedAt).select("id").maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) {
    throw new Error("This entry changed after you opened it. Reload the page, review the latest version, and try again.");
  }
  revalidateEvidencePages();
}
