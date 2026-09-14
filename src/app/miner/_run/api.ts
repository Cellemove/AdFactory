import type { BatchResult, QueueItem, StepResult } from "@/lib/cellumove/corpus/runner.server";
import type { AdStageKey, StageKey } from "./types";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/miner/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload as T;
}

/** The ads a stage would process next for this brand. */
export async function fetchQueue(input: { stage: AdStageKey; brand: string; limit?: number | null; force?: boolean; retryReview?: boolean }): Promise<QueueItem[]> {
  const { items } = await call<{ items: QueueItem[] }>({ action: "queue", ...input });
  return items;
}

/** One stage for one ad. Per-ad problems come back as outcomes, not throws. */
export async function runStep(input: { stage: AdStageKey; adId: string; force?: boolean; retryReview?: boolean; skipGate?: boolean }): Promise<StepResult> {
  return call<StepResult>({ action: "step", ...input });
}

export async function collectWinners(input: { brand: string; target: number }): Promise<BatchResult> {
  return call<BatchResult>({ action: "winners", ...input });
}

export async function rankAds(brand: string): Promise<BatchResult> {
  return call<BatchResult>({ action: "score", brand });
}

export async function minePatterns(brand: string): Promise<BatchResult> {
  return call<BatchResult>({ action: "mine", brand });
}

export async function writePlaybook(brand: string): Promise<BatchResult> {
  return call<BatchResult>({ action: "playbook", brand });
}

export async function syncTeardowns(adIds: string[]): Promise<StepResult[]> {
  const { results } = await call<{ results: StepResult[] }>({ action: "sync-teardowns", adIds });
  return results;
}

/** Batch stages take no queue; this is what the engine calls for them. */
export type BatchStageKey = Extract<StageKey, "ingest" | "score" | "mine" | "playbook">;

export function isBatchStage(stage: StageKey): stage is BatchStageKey {
  return stage === "ingest" || stage === "score" || stage === "mine" || stage === "playbook";
}

export function runBatchStage(stage: BatchStageKey, input: { brand: string; target: number }): Promise<BatchResult> {
  if (stage === "ingest") return collectWinners(input);
  if (stage === "score") return rankAds(input.brand);
  if (stage === "mine") return minePatterns(input.brand);
  return writePlaybook(input.brand);
}
