import "server-only";
import { z } from "zod";
import { supabase, unwrap } from "@/lib/db";
import type { Json, ReferenceAnalysisRow, ReferenceFormatRow } from "@/lib/database.types";
import { resolveTeardownConfiguration } from "@/lib/teardown-config";
import { ReferenceJobSchema, ReferenceResultSchema, ReferenceSourceSchema, ReferenceFrameworkSchema, ReferenceStrategySchema, REFERENCE_ANALYSIS_VERSION, referenceBeats, validFrameworkTimeline, type ReferenceAnalysis } from "./reference-analysis";

export class ReferenceRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function referenceRequest(path: string, body?: unknown): Promise<unknown> {
  const config = resolveTeardownConfiguration().configuration;
  if (!config) throw new ReferenceRequestError("The Teardown integration is not configured.", 503);
  const response = await fetch(`${config.baseUrl}/integrations/adfactory/reference-analyses${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { "X-AdFactory-Token": config.token, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: unknown; message?: unknown };
    const message = typeof payload.detail === "string" ? payload.detail : typeof payload.message === "string" ? payload.message : "The analysis service is unavailable. Please try again.";
    throw new ReferenceRequestError(message, response.status === 404 ? 503 : response.status);
  }
  return response.json();
}
export async function referenceCapabilities() {
  const parsed = z.object({ version: z.literal(REFERENCE_ANALYSIS_VERSION), max_bytes: z.number(), max_seconds: z.number(), modes: z.array(z.string()) }).parse(await referenceRequest("/capabilities"));
  const tables = await Promise.all([
    supabase.from("ReferenceAnalysis").select("id").limit(0),
    supabase.from("ReferenceFormat").select("referenceAnalysisId,strategy").limit(0),
  ]);
  if (tables.some(r => r.error)) throw new ReferenceRequestError("Reference analysis is awaiting its database migration.", 503);
  return parsed;
}
export function referenceView(row: ReferenceAnalysisRow): ReferenceAnalysis {
  return { id: row.id, source: ReferenceSourceSchema.parse(row.source), status: row.status, stage: row.stage,
    error: row.error, result: row.result ? ReferenceResultSchema.parse(row.result) : null,
    referenceFormatId: row.referenceFormatId, nameOverride: row.nameOverride, createdAt: row.createdAt };
}
export async function referenceDetail(row: ReferenceAnalysisRow): Promise<ReferenceAnalysis> {
  const view = referenceView(row);
  if (row.referenceFormatId && view.result) {
    const saved = unwrap<ReferenceFormatRow>(await supabase.from("ReferenceFormat").select("*").eq("id", row.referenceFormatId).single());
    const beats = z.array(z.object({ label: z.string(), note: z.string() })).parse(JSON.parse(saved.beats));
    view.approvedFramework = ReferenceFrameworkSchema.parse({ ...view.result.framework,
      name: saved.name, description: saved.description, best_for_angle: saved.bestForAngle,
      strategy: ReferenceStrategySchema.parse(saved.strategy),
      beats: view.result.framework.beats.map((beat, index) => ({ ...beat, label: beats[index]?.label ?? beat.label, note: beats[index]?.note ?? beat.note })),
    });
  }
  return view;
}
export async function accessibleAnalysis(id: string, actorId: string, write = false): Promise<ReferenceAnalysisRow> {
  z.string().uuid().parse(id);
  const found = await supabase.from("ReferenceAnalysis").select("*").eq("id", id).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const row = found.data as ReferenceAnalysisRow | null;
  if (!row || (row.createdByUserId !== actorId && (write || !row.referenceFormatId))) throw new ReferenceRequestError("Analysis not found.", 404);
  return row;
}
export async function syncReference(row: ReferenceAnalysisRow, remote?: unknown): Promise<ReferenceAnalysisRow> {
  if (row.status === "completed" && row.result && remote === undefined) return row;
  const job = ReferenceJobSchema.parse(remote ?? await referenceRequest(`/${row.teardownJobId}`));
  if (job.id !== row.teardownJobId) throw new Error("Analysis service returned a different job");
  const result = job.status === "completed" ? ReferenceResultSchema.parse(job.result) : null;
  // Do not overwrite completion with an older concurrent polling response.
  if (row.status === "completed" && job.status !== "completed") return row;
  const updated = await supabase.from("ReferenceAnalysis").update({ status: job.status, stage: job.stage, error: job.error, result: result as Json | null, updatedAt: job.updated_at }).eq("id", row.id).lte("updatedAt", job.updated_at).select("*").maybeSingle();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data as ReferenceAnalysisRow | null ?? row;
}
export async function createReference(actorId: string, raw: unknown) {
  const input = z.object({ id: z.string().uuid(), source: ReferenceSourceSchema, nameOverride: z.string().trim().max(80).default("") }).strict().parse(raw);
  const existing = await supabase.from("ReferenceAnalysis").select("*").eq("id", input.id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const row = await accessibleAnalysis(input.id, actorId, true);
    if (JSON.stringify(ReferenceSourceSchema.parse(row.source)) !== JSON.stringify(input.source)) throw new ReferenceRequestError("This request ID belongs to a different video.", 409);
  } else {
    unwrap(await supabase.from("ReferenceAnalysis").insert({ id: input.id, createdByUserId: actorId, source: input.source, nameOverride: input.nameOverride, teardownJobId: input.id }).select("*").single());
  }
  const row = await accessibleAnalysis(input.id, actorId, true);
  const remote = await referenceRequest("", { id: input.id, source: input.source });
  // Backend and app clocks need not agree; the remote timestamp becomes authoritative.
  const job = ReferenceJobSchema.parse(remote);
  unwrap(await supabase.from("ReferenceAnalysis").update({ updatedAt: job.updated_at }).eq("id", row.id).select("*").single());
  return referenceView(await syncReference({ ...row, updatedAt: job.updated_at }, remote));
}
export async function saveReference(row: ReferenceAnalysisRow, actorId: string, raw: unknown) {
  if (!row.result || row.status !== "completed") throw new ReferenceRequestError("Wait for the full analysis before saving.", 409);
  const report = ReferenceResultSchema.parse(row.result);
  const framework = ReferenceFrameworkSchema.parse(raw);
  if (!validFrameworkTimeline(framework, report.duration_sec)) throw new ReferenceRequestError("Framework timings must cover the video without gaps.");
  const saved = unwrap(await supabase.rpc("save_reference_framework", { analysis_id: row.id, actor_id: actorId,
    draft: { name: framework.name, description: framework.description, bestForAngle: framework.best_for_angle,
      duration: Math.max(5, Math.round(report.duration_sec)), beats: referenceBeats(framework), strategy: framework.strategy } }));
  return z.object({ id: z.string(), name: z.string(), optimalDurationSec: z.number().nullable() }).parse(saved);
}
