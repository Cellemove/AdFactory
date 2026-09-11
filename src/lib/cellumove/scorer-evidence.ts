import { createHash } from "node:crypto";
import { z } from "zod";

export const ScorerEvidenceLevelSchema = z.enum(["observed", "probable_winner", "verified_winner"]);
export const ScorerEvidenceIntentSchema = z.enum(["reference_only", "structural_candidate"]);

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().nullable(),
);

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().url("Enter a complete source URL, including https://").nullable(),
);

export const CreateScorerEvidenceSchema = z.object({
  externalId: optionalText,
  title: z.string().trim().min(2, "Give this evidence script a title.").max(200),
  sourceUrl: optionalUrl,
  angleSlug: z.string().trim().min(1, "Select an angle."),
  format: z.string().trim().min(1, "Enter the ad format.").max(100),
  marketCode: optionalText.transform((value) => value?.toUpperCase() ?? null),
  durationSec: z.number().positive().max(3600).nullable(),
  evidenceLevel: ScorerEvidenceLevelSchema,
  intent: ScorerEvidenceIntentSchema,
  performanceEvidence: optionalText,
  notes: optionalText,
  scriptText: z.string().trim().min(20, "Paste the complete script, not only its title.").max(200_000),
}).superRefine((value, context) => {
  if (value.evidenceLevel === "verified_winner" && !value.performanceEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["performanceEvidence"],
      message: "Verified winners require actual performance evidence such as ROAS, spend, or conversion data.",
    });
  }
});

export type CreateScorerEvidenceInput = {
  externalId?: string | null;
  title: string;
  sourceUrl?: string | null;
  angleSlug: string;
  format: string;
  marketCode?: string | null;
  durationSec: number | null;
  evidenceLevel: z.infer<typeof ScorerEvidenceLevelSchema>;
  intent: z.infer<typeof ScorerEvidenceIntentSchema>;
  performanceEvidence?: string | null;
  notes?: string | null;
  scriptText: string;
};
export type ValidatedScorerEvidenceInput = z.output<typeof CreateScorerEvidenceSchema>;

export const ScorerEvidencePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  contentHash: z.string().length(64),
  externalId: z.string().nullable(),
  title: z.string(),
  sourceUrl: z.string().nullable(),
  angleSlug: z.string(),
  format: z.string(),
  marketCode: z.string().nullable(),
  durationSec: z.number().nullable(),
  evidenceLevel: ScorerEvidenceLevelSchema,
  intent: ScorerEvidenceIntentSchema,
  performanceEvidence: z.string().nullable(),
  notes: z.string().nullable(),
  scriptText: z.string(),
  alternativeHookCount: z.number().int().nonnegative(),
  reviewStatus: z.literal("needs_review"),
  capturedAt: z.string(),
  capturedByUserId: z.string(),
});

export type ScorerEvidencePayload = z.infer<typeof ScorerEvidencePayloadSchema>;

export function countAlternativeHooks(scriptText: string): number {
  const matches = scriptText.match(/^\s*HOOK\s+[A-Z0-9]+\b/gim);
  return matches?.length ?? 0;
}

export function scorerEvidenceHash(input: ValidatedScorerEvidenceInput): string {
  return createHash("sha256").update(JSON.stringify({
    externalId: input.externalId,
    sourceUrl: input.sourceUrl,
    angleSlug: input.angleSlug,
    format: input.format.toLowerCase(),
    marketCode: input.marketCode,
    scriptText: input.scriptText,
  })).digest("hex");
}

export function parseScorerEvidencePayload(serialized: string): ScorerEvidencePayload | null {
  try {
    const parsed = ScorerEvidencePayloadSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
