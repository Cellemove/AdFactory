import { z } from "zod";
import { ScorerLayerSchema } from "@/lib/cellumove/script-scorer";

export const GoldAdImportSchema = z.object({
  externalId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  angleSlug: z.string().trim().min(1),
  format: z.string().trim().min(1),
  marketCode: z.string().trim().min(1).nullable().optional(),
  durationSec: z.number().positive().max(600).nullable().optional(),
  scriptText: z.string().min(1),
  beats: z.array(z.object({
    orderIndex: z.number().int().nonnegative(),
    layer: ScorerLayerSchema,
    code: z.string().trim().min(1),
    startSec: z.number().nonnegative().nullable().optional(),
    endSec: z.number().positive().nullable().optional(),
    evidenceQuote: z.string().min(1),
    otherExplanation: z.string().trim().min(1).nullable().optional(),
  }).strict()).min(1),
}).strict();

export type GoldAdImport = z.infer<typeof GoldAdImportSchema>;

export type GoldImportReport = {
  accepted: GoldAdImport[];
  rejected: Array<{ externalId: string; errors: string[] }>;
};

export function validateGoldSetImport(input: unknown, allowedCodes: ReadonlyMap<string, z.infer<typeof ScorerLayerSchema>>): GoldImportReport {
  if (!Array.isArray(input)) return { accepted: [], rejected: [{ externalId: "(file)", errors: ["The normalized file must contain a JSON array."] }] };
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of input) {
    const id = row && typeof row === "object" && "externalId" in row ? String(row.externalId) : "";
    if (id && seenIds.has(id)) duplicateIds.add(id);
    if (id) seenIds.add(id);
  }
  const accepted: GoldAdImport[] = [];
  const rejected: GoldImportReport["rejected"] = [];
  input.forEach((raw, rowIndex) => {
    const parsed = GoldAdImportSchema.safeParse(raw);
    const externalId = raw && typeof raw === "object" && "externalId" in raw ? String(raw.externalId) : `row-${rowIndex + 1}`;
    if (!parsed.success) {
      rejected.push({ externalId, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`) });
      return;
    }
    const ad = parsed.data;
    const errors: string[] = [];
    if (duplicateIds.has(ad.externalId)) errors.push("externalId is duplicated in this file.");
    const indexes = ad.beats.map((beat) => beat.orderIndex);
    if (new Set(indexes).size !== indexes.length) errors.push("Beat orderIndex values must be unique within an ad.");
    const ordered = [...indexes].sort((a, b) => a - b);
    if (ordered.some((value, index) => value !== index)) errors.push("Beat orderIndex values must be contiguous and start at 0.");
    for (const beat of ad.beats) {
      const expectedLayer = allowedCodes.get(beat.code);
      if (!expectedLayer) errors.push(`Unknown taxonomy code: ${beat.code}.`);
      else if (expectedLayer !== beat.layer) errors.push(`Taxonomy code ${beat.code} belongs to ${expectedLayer}, not ${beat.layer}.`);
      if (beat.layer === "OTHER" && !beat.otherExplanation) errors.push(`Beat ${beat.orderIndex} uses OTHER without otherExplanation.`);
      if (!ad.scriptText.includes(beat.evidenceQuote)) errors.push(`Beat ${beat.orderIndex} evidenceQuote is not an exact script substring.`);
      const oneTimingValueMissing = (beat.startSec == null) !== (beat.endSec == null);
      if (oneTimingValueMissing) errors.push(`Beat ${beat.orderIndex} must provide both startSec and endSec or neither.`);
      if (beat.startSec != null && beat.endSec != null && beat.endSec <= beat.startSec) errors.push(`Beat ${beat.orderIndex} endSec must be greater than startSec.`);
    }
    if (errors.length) rejected.push({ externalId: ad.externalId, errors: [...new Set(errors)] });
    else accepted.push(ad);
  });
  return { accepted, rejected };
}
