import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptEvidenceRow } from "@/lib/database.types";
import {
  GOOGLE_SHEET_ID,
  EvidenceUpdateRequestSchema,
  ResetEvidenceFieldSchema,
  buildImportedUpdate,
  classifyEvidenceUrl,
  parseCsv,
  parseSheetEvidenceRow,
  sortEvidenceNewestFirst,
} from "./evidence-library";

test("optimistic concurrency accepts Supabase timestamps with UTC offsets", () => {
  const timestamp = "2026-09-10T12:05:26.968729+00:00";
  assert.equal(EvidenceUpdateRequestSchema.safeParse({
    expectedUpdatedAt: timestamp,
    patch: { notes: "Reviewed" },
  }).success, true);
  assert.equal(ResetEvidenceFieldSchema.safeParse({
    expectedUpdatedAt: timestamp,
    field: "notes",
  }).success, true);
});

test("CSV parser preserves quoted commas, newlines, and escaped quotes", () => {
  assert.deepEqual(parseCsv('A,B\r\n1,"two, three"\r\n2,"line one\nline ""two"""'), [
    ["A", "B"],
    ["1", "two, three"],
    ["2", 'line one\nline "two"'],
  ]);
});

test("source URLs are classified without treating product pages as evidence", () => {
  assert.equal(classifyEvidenceUrl("https://app.milanote.com/1abc"), "milanote");
  assert.equal(classifyEvidenceUrl("https://drive.google.com/file/d/abc"), "google_drive");
  assert.equal(classifyEvidenceUrl("https://docs.google.com/document/d/abc"), "google_docs");
  assert.equal(classifyEvidenceUrl("https://cellumove.com/products/leggings"), "product_destination");
  assert.equal(classifyEvidenceUrl("https://example.com/ad"), "external_html");
});

test("sheet identity uses workbook, tab, and row even when Milanote URLs repeat", () => {
  const headers = ["ID", "Name", "Milanote", "Product"];
  const first = parseSheetEvidenceRow({ spreadsheetId: GOOGLE_SHEET_ID, sheetName: "May", rowNumber: 3, headers, cells: ["SU1", "First", "https://app.milanote.com/shared", "https://cellumove.com/a"] });
  const second = parseSheetEvidenceRow({ spreadsheetId: GOOGLE_SHEET_ID, sheetName: "May", rowNumber: 4, headers, cells: ["SU2", "Second", "https://app.milanote.com/shared", "https://cellumove.com/b"] });
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.sourceKey, second.sourceKey);
  assert.equal(first.sourceValues.primarySourceUrl, "https://app.milanote.com/shared");
});

test("rows with only a product destination are excluded", () => {
  assert.equal(parseSheetEvidenceRow({
    spreadsheetId: GOOGLE_SHEET_ID,
    sheetName: "May",
    rowNumber: 9,
    headers: ["ID", "Name", "Link"],
    cells: ["SU9", "No evidence", "https://cellumove.com/products/test"],
  }), null);
});

test("safe import values do not fabricate metrics from shifted May columns", () => {
  const parsed = parseSheetEvidenceRow({
    spreadsheetId: GOOGLE_SHEET_ID,
    sheetName: "Suley - Mai 2026",
    rowNumber: 3,
    headers: ["ID", "Name", "Editor", "Milanote", "Spend", "ROAS"],
    cells: ["SU3", "Shifted", "https://app.milanote.com/board", "https://cellumove.com/product", "LAUNCHED", "2.8"],
  });
  assert.ok(parsed);
  assert.equal("metrics" in parsed.sourceValues, false);
  assert.deepEqual(parsed.rawCells.slice(4), ["LAUNCHED", "2.8"]);
});

test("a changed source creates a conflict without overwriting a manual override", () => {
  const existing = sampleEvidence({
    title: "My reviewed title",
    sourceValues: { externalId: "SU1", title: "Old source title", primarySourceUrl: "https://example.com/old" },
    overrideFields: ["title"],
  });
  const result = buildImportedUpdate(existing, {
    externalId: "SU1",
    title: "New source title",
    primarySourceUrl: "https://example.com/new",
    sourceLinks: [{ url: "https://example.com/new", type: "external_html", cellIndex: 2, cellLabel: "Link" }],
    sourceTypes: ["external_html"],
  });
  assert.equal(result.normalized.title, undefined);
  assert.equal(result.normalized.primarySourceUrl, "https://example.com/new");
  assert.deepEqual(result.conflictFields, ["title"]);
});

test("evidence is sorted newest to oldest by explicit date, sheet period, and row", () => {
  const mayRow = sampleEvidence({ id: "may", sheetName: "Suley - Mai 2026", sourceRow: 217 });
  const augustRow = sampleEvidence({ id: "august", sheetName: "Suley - August 2026", sourceRow: 64 });
  const septemberOlderRow = sampleEvidence({ id: "september-older", sheetName: "Updated SULEY - SEPTEMBER 2026", sourceRow: 3 });
  const septemberNewerRow = sampleEvidence({ id: "september-newer", sheetName: "Updated SULEY - SEPTEMBER 2026", sourceRow: 24 });
  const explicitlyDated = sampleEvidence({ id: "dated", adDate: "2026-09-09", sheetName: "Suley - Mai 2026", sourceRow: 2 });

  assert.deepEqual(
    sortEvidenceNewestFirst([mayRow, septemberOlderRow, augustRow, explicitlyDated, septemberNewerRow]).map((item) => item.id),
    ["dated", "september-newer", "september-older", "august", "may"],
  );
});

test("editing an entry does not change evidence chronology", () => {
  const newer = sampleEvidence({ id: "newer", sheetName: "Suley - August 2026", updatedAt: "2026-01-01T00:00:00.000Z" });
  const editedOlder = sampleEvidence({ id: "older", sheetName: "Suley - Mai 2026", updatedAt: "2027-01-01T00:00:00.000Z" });

  assert.deepEqual(sortEvidenceNewestFirst([editedOlder, newer]).map((item) => item.id), ["newer", "older"]);
});

function sampleEvidence(overrides: Partial<ScriptEvidenceRow>): ScriptEvidenceRow {
  return {
    id: "e1", sourceProvider: "google_sheet", sourceKey: "key", spreadsheetId: GOOGLE_SHEET_ID,
    sheetName: "May", sourceRow: 3, externalId: "SU1", title: "Title", format: null, avatar: null,
    angleSlug: null, marketCode: null, adDate: null, launchedStatus: null, sourceStatus: null, notes: null,
    metrics: {}, sourceLinks: [], primarySourceUrl: "https://example.com/old", sourceTypes: ["external_html"],
    scriptText: null, deconstructionText: null, evidenceLevel: "observed", performanceEvidence: null, reviewStatus: "unreviewed",
    intent: "structural_candidate", contentStatus: "source_only", sourceValues: {}, overrideFields: [],
    conflictFields: [], latestSourceHash: "hash", lastImportedAt: null, createdByUserId: null,
    createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", ...overrides,
  };
}
