import { z } from "zod";

export const TeardownWorkbookFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  section: z.string(),
  subsection: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  ordinal: z.number(),
});

export const ParsedTeardownWorkbookSchema = z.object({
  title: z.string(),
  sections: z.array(z.object({
    key: z.string(),
    title: z.string(),
    field_keys: z.array(z.string()),
  })),
  fields: z.array(TeardownWorkbookFieldSchema),
});

export const TeardownInsightSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const TeardownBriefSchema = z.object({
  schemaVersion: z.literal(1),
  avatar: z.array(TeardownInsightSchema),
  hook: z.array(TeardownInsightSchema),
  problem: z.array(TeardownInsightSchema),
  solution: z.array(TeardownInsightSchema),
  proof: z.array(TeardownInsightSchema),
  offer: z.array(TeardownInsightSchema),
  cta: z.array(TeardownInsightSchema),
  visual: z.array(TeardownInsightSchema),
  learnings: z.array(TeardownInsightSchema),
});

export type ParsedTeardownWorkbook = z.infer<typeof ParsedTeardownWorkbookSchema>;
export type TeardownBrief = z.infer<typeof TeardownBriefSchema>;
export type TeardownInsight = z.infer<typeof TeardownInsightSchema>;

type BriefCategory = Exclude<keyof TeardownBrief, "schemaVersion">;

const MAX_INSIGHTS_PER_CATEGORY = 8;
const MAX_INSIGHT_LENGTH = 600;

function categoryFor(section: string, label: string): BriefCategory | null {
  const normalizedSection = section.toUpperCase();
  const normalizedLabel = label.toLowerCase();
  if (normalizedSection.includes("PART 1:") || normalizedSection.includes("PART 7:")) return "avatar";
  if (normalizedSection.includes("PART 2:") || normalizedSection.includes("PART 9:")) return "hook";
  if (normalizedSection.includes("PART 3:")) return "problem";
  if (normalizedSection.includes("PART 4:") || normalizedSection.includes("PART 6:")) return "solution";
  if (normalizedSection.includes("PART 5:") || normalizedSection.includes("PART 12:")) return "proof";
  if (normalizedSection.includes("PART 8:")) return "visual";
  if (normalizedSection.includes("PART 10:")) {
    return /cta|call to action|next step|urgency/.test(normalizedLabel) ? "cta" : "offer";
  }
  if (normalizedSection.includes("PART 11:") || normalizedSection.includes("PART 13:") || normalizedSection.includes("PART 14:")) {
    return "learnings";
  }
  return null;
}

function cleanValue(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || /^\[?(?:none|n\/a|not provided|unknown)\]?$/i.test(normalized)) return null;
  return normalized.slice(0, MAX_INSIGHT_LENGTH);
}

export function createTeardownBrief(input: unknown): TeardownBrief {
  const workbook = ParsedTeardownWorkbookSchema.parse(input);
  const brief: TeardownBrief = {
    schemaVersion: 1,
    avatar: [],
    hook: [],
    problem: [],
    solution: [],
    proof: [],
    offer: [],
    cta: [],
    visual: [],
    learnings: [],
  };
  const seen = new Set<string>();

  for (const field of workbook.fields) {
    const category = categoryFor(field.section, field.label);
    const value = cleanValue(field.value);
    if (!category || !value || brief[category].length >= MAX_INSIGHTS_PER_CATEGORY) continue;
    const dedupeKey = `${category}:${field.label}:${value}`.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    brief[category].push({ label: field.label.trim(), value });
  }

  return TeardownBriefSchema.parse(brief);
}
