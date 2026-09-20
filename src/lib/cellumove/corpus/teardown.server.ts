import "server-only";

import type { AdMediaRow, AdTeardownRow, CompetitorAdRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { loadAdMedia, readAdMedia } from "./media.server";
import { recordUsage } from "@/lib/usage";
import { jobToRowPatch, TEARDOWN_TYPICAL_COST_USD, teardownCostUsd, TeardownJobSchema, teardownAdName, teardownRowId, teardownSourceFor, workbookScenes, type TeardownJob } from "./teardown";

// Only Teardown's public endpoints are used (submit, poll, retry, signed
// upload). They need no token; TEARDOWN_INTERNAL_TOKEN stays reserved for the
// Script Studio import through the private integration routes.
function baseUrl(): string {
  const raw = process.env.TEARDOWN_API_BASE_URL?.trim();
  if (!raw) throw new Error("TEARDOWN_API_BASE_URL is not set (e.g. https://teardown-api-67886675912.us-central1.run.app/api/v1).");
  return raw.replace(/\/$/, "");
}

async function teardownRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", headers: { Accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable";
    throw new Error(`Teardown at ${new URL(url).origin} is ${detail}.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? String((payload as { message: unknown }).message) : "";
    throw new Error(`Teardown ${init.method ?? "GET"} ${path} returned ${response.status}${message ? `: ${message}` : ""}.`);
  }
  return payload;
}

function parseAccepted(payload: unknown): TeardownJob {
  const record = payload && typeof payload === "object" && "record" in payload ? (payload as { record: unknown }).record : payload;
  return TeardownJobSchema.parse(record);
}

export async function fetchTeardownJob(teardownId: string): Promise<TeardownJob> {
  return TeardownJobSchema.parse(await teardownRequest(`/deconstructions/${encodeURIComponent(teardownId)}`));
}

// A stored copy goes to Teardown as a plain file upload. It used to be staged in
// Teardown's bucket first ("gcs_object"), but that path records the object's MD5
// (32 hex) where Teardown's database requires a SHA-256 (64), so every staged
// submission was refused with a 500. Stored copies are capped at
// CORPUS_MEDIA_MAX_BYTES (15 MB), far under Cloud Run's 32 MB request limit, and the
// upload path hashes the bytes properly on Teardown's side.
async function storedCopyFile(media: AdMediaRow): Promise<{ blob: Blob; filename: string }> {
  const { bytes, mime } = await readAdMedia(media);
  return { blob: new Blob([new Uint8Array(bytes)], { type: mime }), filename: `${media.competitorAdId}.${mime.split("/")[1] ?? "mp4"}` };
}

export async function loadAdTeardown(competitorAdId: string): Promise<AdTeardownRow | null> {
  const result = await supabase.from("AdTeardown").select("*").eq("competitorAdId", competitorAdId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as AdTeardownRow | null) ?? null;
}

export async function loadAdTeardowns(filters: { ids?: string[]; pendingOnly?: boolean } = {}): Promise<AdTeardownRow[]> {
  if (filters.ids && !filters.ids.length) return [];
  let query = supabase.from("AdTeardown").select("*").order("submittedAt", { ascending: false });
  if (filters.ids?.length) query = query.in("competitorAdId", filters.ids);
  if (filters.pendingOnly) query = query.in("status", ["queued", "processing"]);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as AdTeardownRow[];
}

async function upsertTeardown(row: Partial<AdTeardownRow> & { competitorAdId: string; teardownId: string; sourceKind: AdTeardownRow["sourceKind"] }): Promise<AdTeardownRow> {
  const write = await supabase.from("AdTeardown").upsert(
    { id: teardownRowId(row.competitorAdId), updatedAt: new Date().toISOString(), ...row },
    { onConflict: "competitorAdId" },
  ).select("*").single();
  if (write.error) throw new Error(write.error.message);
  return write.data as AdTeardownRow;
}

/**
 * Queue one ad on Teardown. A failed job is retried in place (same Teardown
 * record, same Sheet row); anything else gets a fresh submission.
 */
export async function submitAdTeardown(ad: CompetitorAdRow, existing: AdTeardownRow | null): Promise<AdTeardownRow> {
  if (existing?.status === "failed") {
    // The accepted response echoes the record as it was (still "failed"); it is queued now.
    const job = parseAccepted(await teardownRequest(`/deconstructions/${encodeURIComponent(existing.teardownId)}/retry`, { method: "POST" }));
    return upsertTeardown({ ...existing, ...jobToRowPatch({ ...job, status: "queued" }), submittedAt: new Date().toISOString() });
  }

  const media = await loadAdMedia(ad.id);
  const source = teardownSourceFor(ad, media);
  if (!source) throw new Error("No live video link and no downloaded copy — download it first (or re-collect ads to refresh the links).");

  const form = new FormData();
  form.set("ad_name", teardownAdName(ad));
  form.set("platform", ad.platform);
  if (source.kind === "url") form.set("source_url", source.url);
  else {
    const file = await storedCopyFile(media!);
    form.set("file", file.blob, file.filename);
  }

  const job = parseAccepted(await teardownRequest("/deconstructions", { method: "POST", body: form }));
  return upsertTeardown({
    competitorAdId: ad.id,
    ...jobToRowPatch(job),
    sourceKind: source.kind === "url" ? source.sourceKind : "stored_copy",
    sourceUrl: source.kind === "url" ? source.url : null,
    mediaSha256: source.kind === "stored" ? source.sha256 : job.sha256 ?? null,
    winnerScore: ad.winnerScore ?? null,
    winnerScoreVersion: ad.winnerScoreVersion ?? null,
    submittedAt: new Date().toISOString(),
  });
}

/**
 * Re-pull finished teardowns. Teardown keeps the full result, so this backfills
 * anything the mirror used to drop (the scene-by-scene script) without spending
 * a penny: these are plain reads, no model work.
 */
export async function resyncAdTeardowns(filters: { ids?: string[] } = {}): Promise<{ synced: number; withScenes: number; failed: number }> {
  const rows = (await loadAdTeardowns(filters)).filter((row) => row.status === "completed");
  let synced = 0;
  let withScenes = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const job = await fetchTeardownJob(row.teardownId);
      const saved = await upsertTeardown({ ...row, ...jobToRowPatch(job) });
      synced += 1;
      if (workbookScenes(saved.workbook).length) withScenes += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, withScenes, failed };
}

/** Pull the current state of a queued/processing job into the mirror. */
export async function syncAdTeardown(row: AdTeardownRow): Promise<AdTeardownRow> {
  const job = await fetchTeardownJob(row.teardownId);
  const saved = await upsertTeardown({ ...row, ...jobToRowPatch(job), mediaSha256: row.mediaSha256 ?? job.sha256 ?? null });
  // Teardown bills in its own GCP project, so this is the only place its spend
  // reaches the Usage ledger. Guarded on the status transition: recorded once.
  if (row.status !== "completed" && saved.status === "completed") {
    await recordUsage({
      feature: "teardown",
      model: "teardown:gemini-2.5-pro",
      usage: { promptTokenCount: saved.promptTokens ?? 0, candidatesTokenCount: saved.outputTokens ?? 0 },
      costUsdOverride: teardownCostUsd(saved) ?? TEARDOWN_TYPICAL_COST_USD,
      metadata: { competitorAdId: saved.competitorAdId, teardownId: saved.teardownId, estimated: teardownCostUsd(saved) == null },
    });
  }
  return saved;
}
