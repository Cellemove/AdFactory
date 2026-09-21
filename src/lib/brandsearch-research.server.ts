import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabase, unwrap, unwrapOpt } from "./db";
import type { AdResearchSnapshotRow, AdResearchJobRow, CompetitorAdRow, Json } from "./database.types";
import { RESEARCH_VERSION, ResearchSnapshotSchema, parseProviderTranscript, providerCopy, type ResearchSnapshot, type ResearchMode } from "./brandsearch-research";
import { recordUsage } from "./usage";

export const brandSearchResearchEnabled = () => process.env.BRANDSEARCH_RESEARCH_ENABLED === "true";
export const defaultResearchMode = (): ResearchMode => brandSearchResearchEnabled() ? "speech_only" : "full_video";
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ProviderResearchError extends Error {
  constructor(message: string, public status: number, public code: string | null) { super(message); }
}

/** Only this transcription POST is permitted. AI analysis is GET-only. */
export async function fetchProviderResearch(externalId: string, kind: "transcription" | "ai-analysis", generate = false): Promise<unknown | null> {
  if (generate && kind !== "transcription") throw new Error("Automatic AI analysis generation is disabled");
  const key = process.env.BRANDSEARCH_API_KEY?.trim();
  if (!key) throw new Error("BRANDSEARCH_API_KEY is not configured");
  const response = await fetch(`https://api.brandsearch.co/v1/meta-ads/${encodeURIComponent(externalId)}/${kind}`, {
    method: generate ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(generate ? 365_000 : 30_000),
    headers: { "X-API-Key": key, Accept: "application/json", ...(generate ? { "Content-Type": "application/json" } : {}) },
    ...(generate ? { body: JSON.stringify({ force_regenerate: false }) } : {}),
  });
  const raw = await response.json().catch(() => null);
  if (!generate && response.status === 404 && ["transcript_not_found", "ai_analysis_not_found"].includes(raw?.error?.code)) return null;
  if (!response.ok) throw new ProviderResearchError(raw?.error?.message ?? `BrandSearch ${kind}: HTTP ${response.status}`, response.status, raw?.error?.code ?? null);
  if (!raw) throw new Error(`BrandSearch ${kind} returned invalid JSON`);
  return raw;
}

export async function getResearchSnapshot(id: string): Promise<ResearchSnapshot> {
  const row = unwrapOpt(await supabase.from("AdResearchSnapshot").select("snapshot").eq("id", id).maybeSingle()) as Pick<AdResearchSnapshotRow, "snapshot"> | null;
  if (!row) throw new Error("Research snapshot not found");
  return ResearchSnapshotSchema.parse(row.snapshot);
}
export async function listResearchSnapshots(): Promise<ResearchSnapshot[]> {
  if (!brandSearchResearchEnabled()) return [];
  const rows = unwrap(await supabase.from("AdResearchJob").select("snapshotId").not("snapshotId", "is", null).order("updatedAt", { ascending: false }).limit(100));
  if (!rows.length) return [];
  const snapshots = unwrap(await supabase.from("AdResearchSnapshot").select("snapshot").in("id", rows.map((r) => r.snapshotId!)));
  return snapshots.map((r) => ResearchSnapshotSchema.parse(r.snapshot));
}

/** Provider verdicts that no retry can change; only an explicit refresh re-checks them. */
const PERMANENT_CODES = new Set(["ad_not_found", "ad_not_video", "transcript_unavailable"]);
const isPermanent = (error: unknown) => error instanceof ProviderResearchError && PERMANENT_CODES.has(error.code ?? "");

export type ResearchImportResult = { snapshot: ResearchSnapshot | null; status: "ready" | "deferred" | "processing"; creditsUsed: number; reused: boolean };

export async function importAdResearch(ad: CompetitorAdRow, options: { refresh?: boolean; generate?: boolean } = {}): Promise<ResearchImportResult> {
  if (!brandSearchResearchEnabled()) throw new Error("BrandSearch research is not enabled");
  if (ad.provider !== "brandsearch" || ad.mediaType !== "video") throw new Error("Select a BrandSearch video ad");
  const token = randomUUID();
  const claimed = unwrap(await supabase.rpc("claim_ad_research", { ad_id: ad.id, token, refresh: options.refresh ?? false }));
  if (!claimed) {
    const job = unwrapOpt(await supabase.from("AdResearchJob").select("*").eq("competitorAdId", ad.id).maybeSingle()) as AdResearchJobRow | null;
    return { snapshot: job?.snapshotId ? await getResearchSnapshot(job.snapshotId) : null, status: job?.status === "ready" ? "ready" : job?.status === "running" ? "processing" : "deferred", creditsUsed: 0, reused: true };
  }
  let creditsUsed = 0;
  try {
    const [speechResult, analysisResult] = await Promise.allSettled([
      fetchProviderResearch(ad.externalId, "transcription"), fetchProviderResearch(ad.externalId, "ai-analysis"),
    ]);
    let rawTranscript = speechResult.status === "fulfilled" ? speechResult.value : null;
    const rawAnalysis = analysisResult.status === "fulfilled" ? analysisResult.value : null;
    let speechError = speechResult.status === "rejected" ? String(speechResult.reason) : null;
    let permanent = speechResult.status === "rejected" && isPermanent(speechResult.reason);
    if (speechResult.status === "fulfilled" && !rawTranscript && options.generate !== false) {
      const reserved = unwrap(await supabase.rpc("reserve_brandsearch_budget", { ad_id: ad.id, budget_scope: "transcript", cap: 10 }));
      if (reserved) {
        try {
          rawTranscript = await fetchProviderResearch(ad.externalId, "transcription", true);
          // A transcript someone else already generated comes back free.
          creditsUsed = (rawTranscript as { generated?: boolean } | null)?.generated === false ? 0 : 1;
          unwrap(await supabase.from("BrandSearchTranscriptRequest").update({ status: "succeeded", updatedAt: new Date().toISOString() }).eq("competitorAdId", ad.id));
        } catch (error) {
          speechError = error instanceof Error ? error.message : String(error);
          permanent = isPermanent(error);
          // Only an explicit rejection proves generation did not start.
          if (error instanceof ProviderResearchError && [400, 401, 402, 403, 404, 422, 429].includes(error.status)) {
            unwrap(await supabase.from("BrandSearchTranscriptRequest").update({ status: "failed", updatedAt: new Date().toISOString() }).eq("competitorAdId", ad.id));
          }
        }
      }
    }
    let transcript: ResearchSnapshot["transcript"] = { status: speechError ? "error" : "missing", segments: [], hook: null, language: null, duration: null, error: speechError };
    if (rawTranscript) {
      try { transcript = parseProviderTranscript(rawTranscript); }
      catch (error) { transcript.error = `Invalid provider transcript: ${error instanceof Error ? error.message : String(error)}`; transcript.status = "error"; }
    }
    if (transcript.status === "available" || transcript.status === "empty") {
      unwrap(await supabase.from("BrandSearchTranscriptRequest").update({ status: "succeeded", updatedAt: new Date().toISOString() }).eq("competitorAdId", ad.id));
    }
    const analysis: ResearchSnapshot["analysis"] = { status: analysisResult.status === "rejected" ? "error" : rawAnalysis ? "available" : "missing",
      interpretation: rawAnalysis ? (rawAnalysis as { analysis?: unknown }).analysis ?? rawAnalysis : null,
      error: analysisResult.status === "rejected" ? String(analysisResult.reason) : null };
    const content = { copy: providerCopy(ad.rawPayload), transcript, analysis };
    const sourceHash = hash(content);
    const id = `bsr_${hash([ad.id, RESEARCH_VERSION, sourceHash]).slice(0, 40)}`;
    const snapshot: ResearchSnapshot = { schemaVersion: 1, id, competitorAdId: ad.id, externalId: ad.externalId, brand: ad.brandName,
      sourceUrl: ad.sourceUrl, retrievedAt: new Date().toISOString(), ...content,
      coverage: { speech: transcript.status === "available" ? "provider_transcript" : transcript.status === "empty" ? "no_speech" : "unassessed", onScreenText: "unassessed", visuals: "unassessed" } };
    unwrap(await supabase.from("AdResearchSnapshot").upsert({ id, competitorAdId: ad.id, schemaVersion: RESEARCH_VERSION, sourceHash,
      snapshot: json(snapshot), rawTranscript: json(rawTranscript), rawAnalysis: json(rawAnalysis) }, { onConflict: "id", ignoreDuplicates: true }));
    const deferred = ["missing", "error"].includes(transcript.status) || analysis.status === "error";
    unwrap(await supabase.from("AdResearchJob").update({ status: deferred ? "deferred" : "ready", snapshotId: id,
      leaseUntil: null, claimToken: null, nextAttemptAt: deferred ? new Date(Date.now() + (permanent ? 30 * 86_400_000 : 3_600_000)).toISOString() : null,
      errorSummary: transcript.error ?? analysis.error, updatedAt: new Date().toISOString(),
    }).eq("competitorAdId", ad.id).eq("claimToken", token));
    await recordUsage({ feature: "brandsearch_research", model: "brandsearch", usage: null, costUsdOverride: 0,
      metadata: { competitorAdId: ad.id, credits: creditsUsed, cacheHit: creditsUsed === 0, transcriptStatus: transcript.status, analysisStatus: analysis.status, deferred } });
    return { snapshot: await getResearchSnapshot(id), status: deferred ? "deferred" : "ready", creditsUsed, reused: false };
  } catch (error) {
    await supabase.from("AdResearchJob").update({ status: "failed", claimToken: null, leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + 3_600_000).toISOString(), errorSummary: String(error).slice(0, 2000), updatedAt: new Date().toISOString(),
    }).eq("competitorAdId", ad.id).eq("claimToken", token);
    throw error;
  }
}
