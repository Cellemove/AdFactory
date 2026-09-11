import "server-only";

import { supabase } from "@/lib/db";
import type { EvidenceEnrichmentJobRow, ScriptEvidenceRow } from "@/lib/database.types";
import { getJsonStringArray } from "@/lib/cellumove/evidence-library";
import {
  extractMilanoteEvidence,
  parseMilanoteBoardLink,
  type MilanoteBoardResponse,
} from "@/lib/cellumove/milanote-api";

const MILANOTE_API_ROOT = "https://app.milanote.com/api";
const REQUEST_TIMEOUT_MS = 20_000;
const BOARD_CONCURRENCY = 6;
const MAX_DESCENDANT_BOARDS = 80;
const MAX_DESCENDANT_DEPTH = 4;

export type MilanoteEnrichmentSummary = {
  jobsTotal: number;
  jobsComplete: number;
  jobsNeedsReview: number;
  jobsFailed: number;
  recordsTotal: number;
  recordsMatched: number;
  recordsUpdated: number;
  recordsPreserved: number;
  recordsAvailable: number;
  recordsNeedsReview: number;
  errors: Array<{ jobId: string; boardId: string | null; message: string }>;
  reviewDetails: Array<{ jobId: string; boardId: string | null; status: string; message: string }>;
};

type JobOutcome = {
  job: EvidenceEnrichmentJobRow;
  update: Partial<EvidenceEnrichmentJobRow>;
  evidenceUpdates: ScriptEvidenceRow[];
  recordsMatched: number;
  recordsUpdated: number;
  recordsPreserved: number;
  recordsAvailable: number;
  recordsNeedsReview: number;
  error: MilanoteEnrichmentSummary["errors"][number] | null;
};

export async function enrichAllMilanoteEvidence(options: { persist?: boolean } = {}): Promise<MilanoteEnrichmentSummary> {
  const persist = options.persist ?? true;
  const [jobsResult, evidenceResult] = await Promise.all([
    supabase.from("EvidenceEnrichmentJob").select("*").eq("provider", "milanote").order("createdAt"),
    supabase.from("ScriptEvidence").select("*").range(0, 999),
  ]);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  if (evidenceResult.error) throw new Error(evidenceResult.error.message);

  const jobs = jobsResult.data ?? [];
  const evidenceById = new Map((evidenceResult.data ?? []).map((evidence) => [evidence.id, evidence]));
  const permissionIds = unique(jobs.flatMap((job) => {
    try {
      const permissionId = parseMilanoteBoardLink(job.boardUrl).permissionId;
      return permissionId ? [permissionId] : [];
    } catch {
      return [];
    }
  }));
  const tokenCache = new Map<string, Promise<string | null>>();
  const now = new Date().toISOString();
  if (persist && jobs.length) {
    const running = await supabase.from("EvidenceEnrichmentJob").update({ status: "running", errorSummary: null, updatedAt: now }).in("id", jobs.map((job) => job.id));
    if (running.error) throw new Error(running.error.message);
  }

  const outcomes = await mapConcurrent(jobs, BOARD_CONCURRENCY, (job) => processJob(job, evidenceById, permissionIds, tokenCache));
  if (persist) {
    const evidenceUpdates = outcomes.flatMap((outcome) => outcome.evidenceUpdates);
    await chunked(evidenceUpdates, 100, async (rows) => {
      const result = await supabase.from("ScriptEvidence").upsert(rows, { onConflict: "id" });
      if (result.error) throw new Error(result.error.message);
    });
    await chunked(outcomes, 100, async (batch) => {
      for (const outcome of batch) {
        const result = await supabase.from("EvidenceEnrichmentJob").update(outcome.update).eq("id", outcome.job.id);
        if (result.error) throw new Error(result.error.message);
      }
    });
  }

  return {
    jobsTotal: jobs.length,
    jobsComplete: outcomes.filter((outcome) => outcome.update.status === "complete").length,
    jobsNeedsReview: outcomes.filter((outcome) => outcome.update.status === "needs_review").length,
    jobsFailed: outcomes.filter((outcome) => outcome.update.status === "failed").length,
    recordsTotal: outcomes.reduce((sum, outcome) => sum + getJsonStringArray(outcome.job.evidenceIds).length, 0),
    recordsMatched: outcomes.reduce((sum, outcome) => sum + outcome.recordsMatched, 0),
    recordsUpdated: outcomes.reduce((sum, outcome) => sum + outcome.recordsUpdated, 0),
    recordsPreserved: outcomes.reduce((sum, outcome) => sum + outcome.recordsPreserved, 0),
    recordsAvailable: outcomes.reduce((sum, outcome) => sum + outcome.recordsAvailable, 0),
    recordsNeedsReview: outcomes.reduce((sum, outcome) => sum + outcome.recordsNeedsReview, 0),
    errors: outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []),
    reviewDetails: outcomes
      .filter((outcome) => outcome.update.status !== "complete")
      .map((outcome) => ({
        jobId: outcome.job.id,
        boardId: safeBoardId(outcome.job.boardUrl),
        status: String(outcome.update.status),
        message: String(outcome.update.errorSummary ?? "Review required."),
      })),
  };
}

async function processJob(
  job: EvidenceEnrichmentJobRow,
  evidenceById: Map<string, ScriptEvidenceRow>,
  permissionIds: string[],
  tokenCache: Map<string, Promise<string | null>>,
): Promise<JobOutcome> {
  const evidence = getJsonStringArray(job.evidenceIds).map((id) => evidenceById.get(id)).filter((row): row is ScriptEvidenceRow => Boolean(row));
  let boardId: string | null = null;
  try {
    const parsed = parseMilanoteBoardLink(job.boardUrl);
    boardId = parsed.boardId;
    const candidates = unique([parsed.permissionId, ...permissionIds].filter((value): value is string => Boolean(value)));
    const board = await fetchAccessibleBoard(boardId, candidates, tokenCache);
    if (!board) throw new Error("Milanote returned only skeleton data. The board may be deleted, private, or outside the shared workspace.");

    const evidenceUpdates: ScriptEvidenceRow[] = [];
    const reasons: string[] = [];
    let recordsMatched = 0;
    let recordsUpdated = 0;
    let recordsPreserved = 0;
    let recordsAvailable = 0;

    for (const row of evidence) {
      const result = extractMilanoteEvidence(board, boardId, row, evidence.length);
      if (result.status !== "matched") {
        const overrides = new Set(getJsonStringArray(row.overrideFields));
        if (overrides.has("scriptText") && row.scriptText?.trim()) {
          recordsAvailable += 1;
          recordsPreserved += 1;
        } else {
          if (row.scriptText || row.contentStatus === "script_available") {
            evidenceUpdates.push({
              ...row,
              scriptText: null,
              contentStatus: "enrichment_pending",
              updatedAt: new Date().toISOString(),
            });
            recordsUpdated += 1;
          }
          reasons.push(`${row.externalId ?? row.id}: ${result.reason}`);
        }
        continue;
      }
      recordsMatched += 1;
      const overrides = new Set(getJsonStringArray(row.overrideFields));
      const scriptText = overrides.has("scriptText") ? row.scriptText : result.extraction.scriptText;
      const deconstructionText = overrides.has("deconstructionText")
        ? row.deconstructionText
        : result.extraction.deconstructionText ?? row.deconstructionText;
      const next = {
        ...row,
        scriptText,
        deconstructionText,
        contentStatus: scriptText?.trim() ? "script_available" : "enrichment_pending",
        updatedAt: new Date().toISOString(),
      };
      if (scriptText?.trim()) recordsAvailable += 1;
      if (overrides.has("scriptText")) recordsPreserved += 1;
      const changed = next.scriptText !== row.scriptText
        || next.deconstructionText !== row.deconstructionText
        || next.contentStatus !== row.contentStatus;
      if (changed) {
        evidenceUpdates.push(next);
        recordsUpdated += 1;
      }
    }

    const recordsNeedsReview = Math.max(0, evidence.length - recordsAvailable);
    const status = recordsNeedsReview === 0 ? "complete" : "needs_review";
    const errorSummary = recordsNeedsReview
      ? `${recordsNeedsReview} of ${evidence.length} evidence entries still need review. ${reasons.slice(0, 4).join(" | ")}`.slice(0, 2_000)
      : null;
    return {
      job,
      update: { status, matchCount: recordsAvailable, errorSummary, updatedAt: new Date().toISOString() },
      evidenceUpdates,
      recordsMatched,
      recordsUpdated,
      recordsPreserved,
      recordsAvailable,
      recordsNeedsReview,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recordsAvailable = evidence.filter((row) => row.scriptText?.trim()).length;
    return {
      job,
      update: { status: "failed", matchCount: recordsAvailable, errorSummary: message.slice(0, 2_000), updatedAt: new Date().toISOString() },
      evidenceUpdates: [],
      recordsMatched: 0,
      recordsUpdated: 0,
      recordsPreserved: recordsAvailable,
      recordsAvailable,
      recordsNeedsReview: evidence.length - recordsAvailable,
      error: { jobId: job.id, boardId, message },
    };
  }
}

async function fetchAccessibleBoard(
  boardId: string,
  permissionIds: string[],
  tokenCache: Map<string, Promise<string | null>>,
): Promise<MilanoteBoardResponse | null> {
  for (const permissionId of permissionIds) {
    const tokenPromise = tokenCache.get(permissionId) ?? requestPermissionToken(permissionId, boardId);
    tokenCache.set(permissionId, tokenPromise);
    const token = await tokenPromise;
    if (!token) continue;
    const params = new URLSearchParams({
      ids: boardId,
      tokens: token,
      loadAncestors: "true",
      excludeSelf: "false",
      canvasOrder: "true",
    });
    const response = await fetch(`${MILANOTE_API_ROOT}/boards?${params}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) continue;
    const board = await response.json() as MilanoteBoardResponse;
    const root = board.elements?.[boardId];
    if (root && root.elementType !== "SKELETON" && board.childrenReturned?.[boardId] !== false) {
      return expandDescendantBoards(board, boardId, token);
    }
  }
  return null;
}

async function expandDescendantBoards(
  initial: MilanoteBoardResponse,
  rootBoardId: string,
  token: string,
): Promise<MilanoteBoardResponse> {
  const merged: MilanoteBoardResponse = {
    ...initial,
    elements: { ...(initial.elements ?? {}) },
    childrenReturned: { ...(initial.childrenReturned ?? {}) },
    errors: { ...(initial.errors ?? {}) },
  };
  const queue: Array<{ boardId: string; depth: number }> = [{ boardId: rootBoardId, depth: 0 }];
  const requested = new Set([rootBoardId]);

  while (queue.length && requested.size < MAX_DESCENDANT_BOARDS) {
    const current = queue.shift()!;
    if (current.depth >= MAX_DESCENDANT_DEPTH) continue;
    const childBoards = Object.values(merged.elements ?? {})
      .filter((element) => element.elementType === "BOARD" && element.location?.parentId === current.boardId)
      .map((element) => element.id ?? element._id)
      .filter((id): id is string => Boolean(id) && !requested.has(id!))
      .slice(0, MAX_DESCENDANT_BOARDS - requested.size);
    if (!childBoards.length) continue;
    childBoards.forEach((id) => requested.add(id));
    const loaded = await fetchBoardBatch(childBoards, token);
    Object.assign(merged.elements!, loaded.elements ?? {});
    Object.assign(merged.childrenReturned!, loaded.childrenReturned ?? {});
    Object.assign(merged.errors!, loaded.errors ?? {});
    childBoards.forEach((id) => queue.push({ boardId: id, depth: current.depth + 1 }));
  }
  return merged;
}

async function fetchBoardBatch(boardIds: string[], token: string): Promise<MilanoteBoardResponse> {
  const params = new URLSearchParams({
    ids: boardIds.join(","),
    tokens: token,
    loadAncestors: "false",
    excludeSelf: "false",
    canvasOrder: "true",
  });
  const response = await fetch(`${MILANOTE_API_ROOT}/boards?${params}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return {};
  return response.json() as Promise<MilanoteBoardResponse>;
}

async function requestPermissionToken(permissionId: string, elementId: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ elementId });
    const response = await fetch(`${MILANOTE_API_ROOT}/permissions/token/${encodeURIComponent(permissionId)}?${params}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as { token?: unknown };
    return typeof body.token === "string" && body.token ? body.token : null;
  } catch {
    return null;
  }
}

async function mapConcurrent<T, U>(items: T[], concurrency: number, operation: (item: T) => Promise<U>): Promise<U[]> {
  const output = new Array<U>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await operation(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

async function chunked<T>(items: T[], size: number, operation: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += size) await operation(items.slice(index, index + size));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeBoardId(url: string): string | null {
  try {
    return parseMilanoteBoardLink(url).boardId;
  } catch {
    return null;
  }
}
