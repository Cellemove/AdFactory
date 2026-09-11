import "server-only";

import { createHash } from "node:crypto";
import { newId, supabase } from "@/lib/db";
import type {
  EvidenceEnrichmentJobRow,
  EvidenceImportRunRow,
  Json,
  ScriptEvidenceRow,
} from "@/lib/database.types";
import {
  GOOGLE_SHEET_ID,
  GOOGLE_SHEET_TABS,
  buildImportedUpdate,
  getJsonStringArray,
  getSourceLinks,
  parseCsv,
  parseSheetEvidenceRow,
  type ParsedSheetEvidence,
} from "@/lib/cellumove/evidence-library";

type TabImport = {
  sheetName: string;
  csvHash: string;
  headers: string[];
  rows: ParsedSheetEvidence[];
};

type ImportCounts = {
  total: number;
  created: number;
  changed: number;
  unchanged: number;
  revisions: number;
  perTab: Record<string, { candidates: number; created: number; changed: number; unchanged: number }>;
};

export async function createGoogleSheetImportRun(requestedByUserId: string): Promise<EvidenceImportRunRow> {
  const now = new Date().toISOString();
  const row = {
    id: newId(),
    provider: "google_sheet",
    sourceId: GOOGLE_SHEET_ID,
    status: "pending",
    selectedSheets: [...GOOGLE_SHEET_TABS] as unknown as Json,
    counts: {} as Json,
    warnings: [] as unknown as Json,
    errors: [] as unknown as Json,
    requestedByUserId,
    createdAt: now,
  };
  const result = await supabase.from("EvidenceImportRun").insert(row).select("*").single();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Could not create the evidence import run.");
  return result.data;
}

export async function executeGoogleSheetEvidenceImport(runId: string): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    await assertUpdate(await supabase.from("EvidenceImportRun").update({ status: "running", startedAt }).eq("id", runId));
    const tabs = await Promise.all(GOOGLE_SHEET_TABS.map(fetchSheetTab));
    const importedRows = tabs.flatMap((tab) => tab.rows);
    const workbookVersion = createHash("sha256")
      .update(tabs.map((tab) => `${tab.sheetName}:${tab.csvHash}`).join("\n"))
      .digest("hex");

    const existingResult = await supabase
      .from("ScriptEvidence")
      .select("*")
      .eq("spreadsheetId", GOOGLE_SHEET_ID)
      .in("sheetName", [...GOOGLE_SHEET_TABS])
      .range(0, 999);
    if (existingResult.error) throw new Error(existingResult.error.message);
    const existingByKey = new Map((existingResult.data ?? []).map((row) => [row.sourceKey, row]));
    const now = new Date().toISOString();
    const counts: ImportCounts = {
      total: importedRows.length,
      created: 0,
      changed: 0,
      unchanged: 0,
      revisions: 0,
      perTab: Object.fromEntries(tabs.map((tab) => [tab.sheetName, { candidates: tab.rows.length, created: 0, changed: 0, unchanged: 0 }])),
    };
    const evidenceRows: ScriptEvidenceRow[] = [];
    const revisions: Array<{
      id: string;
      evidenceId: string;
      importRunId: string;
      spreadsheetId: string;
      sheetName: string;
      rowNumber: number;
      rawHeaders: Json;
      rawCells: Json;
      sourceHash: string;
      extractedSourceUrls: Json;
      importedAt: string;
    }> = [];

    for (const imported of importedRows) {
      const existing = existingByKey.get(imported.sourceKey) ?? null;
      const tabCount = counts.perTab[imported.sheetName]!;
      const changed = !existing || existing.latestSourceHash !== imported.sourceHash;
      if (!existing) {
        counts.created += 1;
        tabCount.created += 1;
      } else if (changed) {
        counts.changed += 1;
        tabCount.changed += 1;
      } else {
        counts.unchanged += 1;
        tabCount.unchanged += 1;
      }

      const merge = buildImportedUpdate(existing, imported.sourceValues);
      const initialContentStatus = imported.sourceValues.sourceTypes.includes("milanote") ? "enrichment_pending" : "source_only";
      const row: ScriptEvidenceRow = existing ? {
        ...existing,
        ...merge.normalized,
        sourceValues: imported.sourceValues as unknown as Json,
        overrideFields: merge.overrideFields as unknown as Json,
        conflictFields: merge.conflictFields as unknown as Json,
        latestSourceHash: imported.sourceHash,
        lastImportedAt: now,
        updatedAt: changed ? now : existing.updatedAt,
      } : {
        id: newId(),
        sourceProvider: "google_sheet",
        sourceKey: imported.sourceKey,
        spreadsheetId: imported.spreadsheetId,
        sheetName: imported.sheetName,
        sourceRow: imported.sourceRow,
        externalId: imported.sourceValues.externalId,
        title: imported.sourceValues.title,
        format: null,
        avatar: null,
        angleSlug: null,
        marketCode: null,
        adDate: null,
        launchedStatus: null,
        sourceStatus: null,
        notes: null,
        metrics: {},
        sourceLinks: imported.sourceValues.sourceLinks as unknown as Json,
        primarySourceUrl: imported.sourceValues.primarySourceUrl,
        sourceTypes: imported.sourceValues.sourceTypes as unknown as Json,
        scriptText: null,
        deconstructionText: null,
        evidenceLevel: "observed",
        performanceEvidence: null,
        reviewStatus: "unreviewed",
        intent: "structural_candidate",
        contentStatus: initialContentStatus,
        sourceValues: imported.sourceValues as unknown as Json,
        overrideFields: [],
        conflictFields: [],
        latestSourceHash: imported.sourceHash,
        lastImportedAt: now,
        createdByUserId: null,
        createdAt: now,
        updatedAt: now,
      };
      evidenceRows.push(row);
      if (changed) {
        counts.revisions += 1;
        revisions.push({
          id: newId(),
          evidenceId: row.id,
          importRunId: runId,
          spreadsheetId: imported.spreadsheetId,
          sheetName: imported.sheetName,
          rowNumber: imported.sourceRow,
          rawHeaders: imported.rawHeaders as unknown as Json,
          rawCells: imported.rawCells as unknown as Json,
          sourceHash: imported.sourceHash,
          extractedSourceUrls: imported.sourceValues.sourceLinks as unknown as Json,
          importedAt: now,
        });
      }
    }

    await chunked(evidenceRows, 100, async (chunk) => {
      const result = await supabase.from("ScriptEvidence").upsert(chunk, { onConflict: "sourceKey" });
      if (result.error) throw new Error(result.error.message);
    });
    await chunked(revisions, 100, async (chunk) => {
      const result = await supabase.from("ScriptEvidenceRevision").upsert(chunk, {
        onConflict: "evidenceId,sourceHash",
        ignoreDuplicates: true,
      });
      if (result.error) throw new Error(result.error.message);
    });
    await queueMilanoteBoards(evidenceRows, now);

    const warnings = [
      "May metric cells were preserved in rawCells but intentionally not mapped because the source data is shifted relative to its headers.",
      "Milanote rows were grouped into enrichment jobs. No script is attached until the connector returns exactly one match.",
      "Google Drive and Docs URLs are preserved but are not crawled by this importer.",
    ];
    await assertUpdate(await supabase.from("EvidenceImportRun").update({
      status: "complete",
      workbookVersion,
      counts: counts as unknown as Json,
      warnings: warnings as unknown as Json,
      errors: [] as unknown as Json,
      completedAt: new Date().toISOString(),
    }).eq("id", runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("EvidenceImportRun").update({
      status: "failed",
      errors: [{ message }] as unknown as Json,
      completedAt: new Date().toISOString(),
    }).eq("id", runId);
    console.error("Google Sheet evidence import failed", { runId, error: message });
  }
}

async function fetchSheetTab(sheetName: (typeof GOOGLE_SHEET_TABS)[number]): Promise<TabImport> {
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Google Sheets returned ${response.status} for ${sheetName}.`);
  const csv = await response.text();
  const parsed = parseCsv(csv);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).flatMap((cells, index) => {
    const item = parseSheetEvidenceRow({
      spreadsheetId: GOOGLE_SHEET_ID,
      sheetName,
      rowNumber: index + 2,
      headers,
      cells,
    });
    return item ? [item] : [];
  });
  return {
    sheetName,
    csvHash: createHash("sha256").update(csv).digest("hex"),
    headers,
    rows,
  };
}

async function queueMilanoteBoards(evidenceRows: ScriptEvidenceRow[], now: string): Promise<void> {
  const grouped = new Map<string, string[]>();
  evidenceRows.forEach((evidence) => {
    getSourceLinks(evidence.sourceLinks).filter((link) => link.type === "milanote").forEach((link) => {
      const ids = grouped.get(link.url) ?? [];
      if (!ids.includes(evidence.id)) ids.push(evidence.id);
      grouped.set(link.url, ids);
    });
  });
  const boardUrls = [...grouped.keys()];
  if (!boardUrls.length) return;
  const existingJobs: EvidenceEnrichmentJobRow[] = [];
  await chunked(boardUrls, 100, async (urls) => {
    const result = await supabase.from("EvidenceEnrichmentJob").select("*").in("boardUrl", urls);
    if (result.error) throw new Error(result.error.message);
    existingJobs.push(...(result.data ?? []));
  });
  const byUrl = new Map(existingJobs.map((job) => [job.boardUrl, job]));
  const jobs = boardUrls.map((boardUrl) => {
    const existing = byUrl.get(boardUrl);
    const previousIds = getJsonStringArray(existing?.evidenceIds);
    const evidenceIds = [...new Set([...previousIds, ...(grouped.get(boardUrl) ?? [])])];
    const gainedEvidence = evidenceIds.length !== previousIds.length;
    return {
      id: existing?.id ?? newId(),
      provider: "milanote",
      boardUrl,
      evidenceIds: evidenceIds as unknown as Json,
      status: existing ? (gainedEvidence ? "pending" : existing.status) : "pending",
      matchCount: existing?.matchCount ?? null,
      errorSummary: gainedEvidence ? null : existing?.errorSummary ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: gainedEvidence || !existing ? now : existing.updatedAt,
    };
  });
  await chunked(jobs, 100, async (chunk) => {
    const result = await supabase.from("EvidenceEnrichmentJob").upsert(chunk, { onConflict: "provider,boardUrl" });
    if (result.error) throw new Error(result.error.message);
  });
}

async function chunked<T>(items: T[], size: number, operation: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += size) await operation(items.slice(index, index + size));
}

async function assertUpdate(result: { error: { message: string } | null }): Promise<void> {
  if (result.error) throw new Error(result.error.message);
}
