import { z } from "zod";
import type { Json, ScriptEvidenceRow } from "@/lib/database.types";

export const GOOGLE_SHEET_ID = "15oJ8uIkJ9cra4zHLj2WJDicf2rYe1vj382aEbAXZQpY";
export const GOOGLE_SHEET_TABS = [
  "Suley - Mai 2026",
  "Suley - August 2026",
  "Updated SULEY - SEPTEMBER 2026",
] as const;

export const EVIDENCE_LEVELS = ["observed", "probable_winner", "verified_winner"] as const;
export const REVIEW_STATUSES = ["unreviewed", "needs_review", "shortlisted", "approved", "rejected", "excluded"] as const;
export const EVIDENCE_INTENTS = ["reference_only", "structural_candidate"] as const;
export const SOURCE_TYPES = ["milanote", "google_drive", "google_docs", "external_html", "product_destination"] as const;

const SHEET_PERIODS: Record<string, number> = {
  "Suley - Mai 2026": Date.UTC(2026, 4, 1),
  "Suley - August 2026": Date.UTC(2026, 7, 1),
  "Updated SULEY - SEPTEMBER 2026": Date.UTC(2026, 8, 1),
};

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type EvidenceReviewStatus = (typeof REVIEW_STATUSES)[number];
export type EvidenceSourceType = (typeof SOURCE_TYPES)[number];

export type EvidenceSourceLink = {
  url: string;
  type: EvidenceSourceType;
  cellIndex: number;
  cellLabel: string;
};

export type ImportedEvidenceSourceValues = {
  externalId: string;
  title: string;
  primarySourceUrl: string;
  sourceLinks: EvidenceSourceLink[];
  sourceTypes: EvidenceSourceType[];
};

export type ParsedSheetEvidence = {
  sourceKey: string;
  spreadsheetId: string;
  sheetName: string;
  sourceRow: number;
  sourceHash: string;
  rawHeaders: string[];
  rawCells: string[];
  sourceValues: ImportedEvidenceSourceValues;
};

const nullableText = z.union([z.string().trim().max(200_000), z.null()]);
const nullableShortText = z.union([z.string().trim().max(500), z.null()]);
const nullableUrl = z.union([z.string().trim().url().max(4000), z.literal(""), z.null()])
  .transform((value) => value === "" ? null : value);
const nullableNumber = z.union([z.number().finite(), z.null()]);

export const EvidenceMetricsSchema = z.object({
  spend: nullableNumber.optional(),
  roas: nullableNumber.optional(),
  hookRate: nullableNumber.optional(),
  holdRate: nullableNumber.optional(),
  cpc: nullableNumber.optional(),
  cpatc: nullableNumber.optional(),
}).strict();

export const EvidencePatchSchema = z.object({
  externalId: nullableShortText.optional(),
  title: z.string().trim().min(1).max(500).optional(),
  format: nullableShortText.optional(),
  avatar: nullableShortText.optional(),
  angleSlug: nullableShortText.optional(),
  marketCode: nullableShortText.transform((value) => value?.toUpperCase() ?? null).optional(),
  adDate: nullableShortText.optional(),
  launchedStatus: nullableShortText.optional(),
  sourceStatus: nullableShortText.optional(),
  notes: nullableText.optional(),
  metrics: EvidenceMetricsSchema.optional(),
  primarySourceUrl: nullableUrl.optional(),
  scriptText: nullableText.optional(),
  evidenceLevel: z.enum(EVIDENCE_LEVELS).optional(),
  performanceEvidence: nullableText.optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  intent: z.enum(EVIDENCE_INTENTS).optional(),
}).strict();

export const EvidenceUpdateRequestSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  patch: EvidencePatchSchema,
}).strict();

export const EvidenceBulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  patch: EvidencePatchSchema.pick({
    angleSlug: true,
    format: true,
    marketCode: true,
    evidenceLevel: true,
    reviewStatus: true,
  }),
}).strict().refine((value) => Object.keys(value.patch).length === 1, {
  message: "Choose exactly one field for a bulk update.",
  path: ["patch"],
});

export const ResetEvidenceFieldSchema = z.object({
  field: z.enum([
    "externalId", "title", "format", "avatar", "angleSlug", "marketCode", "adDate",
    "launchedStatus", "sourceStatus", "notes", "metrics", "primarySourceUrl", "scriptText",
    "evidenceLevel", "performanceEvidence", "reviewStatus", "intent",
  ]),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export type EvidencePatch = z.infer<typeof EvidencePatchSchema>;
export type EditableEvidenceField = keyof EvidencePatch;

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function classifyEvidenceUrl(rawUrl: string): EvidenceSourceType {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "app.milanote.com" || host.endsWith(".milanote.com") || host === "milanote.com") return "milanote";
    if (host === "drive.google.com") return "google_drive";
    if (host === "docs.google.com" && url.pathname.startsWith("/document/")) return "google_docs";
    if (host === "cellumove.com" || host.endsWith(".cellumove.com")) return "product_destination";
    return "external_html";
  } catch {
    return "external_html";
  }
}

export function extractEvidenceUrls(cells: string[], headers: string[]): EvidenceSourceLink[] {
  const links: EvidenceSourceLink[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  cells.forEach((cell, cellIndex) => {
    const matches = cell.match(pattern) ?? [];
    matches.forEach((match) => {
      const url = match.replace(/[),.;\]}]+$/g, "");
      links.push({
        url,
        type: classifyEvidenceUrl(url),
        cellIndex,
        cellLabel: headers[cellIndex]?.trim() || `Column ${columnLabel(cellIndex)}`,
      });
    });
  });
  return links;
}

export function parseSheetEvidenceRow(input: {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  headers: string[];
  cells: string[];
}): ParsedSheetEvidence | null {
  const externalId = input.cells[0]?.trim() ?? "";
  if (!externalId) return null;
  const links = extractEvidenceUrls(input.cells, input.headers);
  const evidenceLinks = links.filter((link) => link.type !== "product_destination");
  if (!evidenceLinks.length) return null;
  const title = input.cells[1]?.trim() || externalId;
  const sourceTypes = [...new Set(links.map((link) => link.type))];
  const sourceValues: ImportedEvidenceSourceValues = {
    externalId,
    title,
    primarySourceUrl: evidenceLinks[0]!.url,
    sourceLinks: links,
    sourceTypes,
  };
  return {
    sourceKey: googleSheetEvidenceKey(input.spreadsheetId, input.sheetName, input.rowNumber),
    spreadsheetId: input.spreadsheetId,
    sheetName: input.sheetName,
    sourceRow: input.rowNumber,
    sourceHash: hashJson({ headers: input.headers, cells: input.cells }),
    rawHeaders: [...input.headers],
    rawCells: [...input.cells],
    sourceValues,
  };
}

export function googleSheetEvidenceKey(spreadsheetId: string, sheetName: string, rowNumber: number): string {
  return `google_sheet:${spreadsheetId}:${sheetName}:${rowNumber}`;
}

// A stable change fingerprint, not a security primitive. Keeping it runtime-
// neutral lets the same row parser power server imports and client provenance.
export function hashJson(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function getJsonStringArray(value: Json | undefined | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function getSourceLinks(value: Json | undefined | null): EvidenceSourceLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Json | undefined>;
    if (typeof record.url !== "string" || typeof record.type !== "string") return [];
    if (!SOURCE_TYPES.includes(record.type as EvidenceSourceType)) return [];
    return [{
      url: record.url,
      type: record.type as EvidenceSourceType,
      cellIndex: typeof record.cellIndex === "number" ? record.cellIndex : -1,
      cellLabel: typeof record.cellLabel === "string" ? record.cellLabel : "Source",
    }];
  });
}

/**
 * Orders evidence by the date of the evidence itself, not by its last edit.
 * Imported rows currently have month-level chronology in their tab names, so
 * later rows within the same tab are treated as newer. Manual/unknown sources
 * fall back to their creation time.
 */
export function sortEvidenceNewestFirst(items: ScriptEvidenceRow[]): ScriptEvidenceRow[] {
  return [...items].sort(compareEvidenceNewestFirst);
}

export function compareEvidenceNewestFirst(left: ScriptEvidenceRow, right: ScriptEvidenceRow): number {
  const periodDifference = evidencePeriod(right) - evidencePeriod(left);
  if (periodDifference !== 0) return periodDifference;

  const rowDifference = (right.sourceRow ?? -1) - (left.sourceRow ?? -1);
  if (rowDifference !== 0) return rowDifference;

  const createdDifference = timestamp(right.createdAt) - timestamp(left.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return right.id.localeCompare(left.id);
}

export function buildImportedUpdate(
  existing: ScriptEvidenceRow | null,
  sourceValues: ImportedEvidenceSourceValues,
): { normalized: Partial<ScriptEvidenceRow>; overrideFields: string[]; conflictFields: string[] } {
  const overrides = getJsonStringArray(existing?.overrideFields);
  const previousSource = asRecord(existing?.sourceValues);
  const nextSource = sourceValues as unknown as Record<string, Json>;
  const normalized: Partial<ScriptEvidenceRow> = {};
  const conflictFields: string[] = [];

  (["externalId", "title", "primarySourceUrl"] as const).forEach((field) => {
    if (overrides.includes(field)) {
      if (existing && previousSource[field] !== undefined && !jsonEqual(previousSource[field], nextSource[field])) conflictFields.push(field);
    } else normalized[field] = sourceValues[field];
  });
  normalized.sourceLinks = sourceValues.sourceLinks as unknown as Json;
  normalized.sourceTypes = sourceValues.sourceTypes as unknown as Json;
  return { normalized, overrideFields: overrides, conflictFields };
}

export function computeOverrideFields(
  existing: ScriptEvidenceRow,
  patch: EvidencePatch,
): { overrideFields: string[]; conflictFields: string[] } {
  const sourceValues = asRecord(existing.sourceValues);
  const overrides = new Set(getJsonStringArray(existing.overrideFields));
  const conflicts = new Set(getJsonStringArray(existing.conflictFields));
  Object.entries(patch).forEach(([field, value]) => {
    if (field in sourceValues && jsonEqual(value as Json, sourceValues[field])) {
      overrides.delete(field);
      conflicts.delete(field);
    } else overrides.add(field);
  });
  return { overrideFields: [...overrides].sort(), conflictFields: [...conflicts].sort() };
}

export function sourceValueForReset(evidence: ScriptEvidenceRow, field: EditableEvidenceField): Json | undefined {
  return asRecord(evidence.sourceValues)[field];
}

export function validateVerifiedWinner(input: Pick<ScriptEvidenceRow, "evidenceLevel" | "performanceEvidence">): string | null {
  if (input.evidenceLevel === "verified_winner" && !input.performanceEvidence?.trim()) {
    return "Verified winners require explicit performance evidence.";
  }
  return null;
}

export function columnLabel(index: number): string {
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

function asRecord(value: Json | undefined | null): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

function jsonEqual(left: Json | undefined, right: Json | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function evidencePeriod(item: ScriptEvidenceRow): number {
  const explicitDate = timestamp(item.adDate);
  if (explicitDate > 0) return explicitDate;
  const sheetPeriod = item.sheetName ? SHEET_PERIODS[item.sheetName] : undefined;
  if (sheetPeriod !== undefined) return sheetPeriod;
  return timestamp(item.createdAt);
}

function timestamp(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
