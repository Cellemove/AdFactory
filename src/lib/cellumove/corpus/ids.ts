// Deterministic ids for the corpus pipeline. Every stage is idempotent because
// its run key is a hash of exactly the inputs that would change its output —
// re-running a stage on unchanged inputs finds the existing row instead of
// spending another model call.

import { createHash } from "node:crypto";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable id for a provider ad — same derivation the /spy import uses. */
export function competitorAdId(provider: string, platform: string, externalId: string): string {
  return `cad_${sha(`${provider}:${platform}:${externalId}`).slice(0, 24)}`;
}

export function mediaId(competitorAdId: string): string {
  return `adm_${sha(competitorAdId).slice(0, 24)}`;
}

/** Hash of the parts that determine a run's output. */
export function runKey(parts: Array<string | number | boolean | null | undefined>): string {
  return sha(parts.map((part) => String(part ?? "")).join(":"));
}

export function transcriptRunId(key: string): string {
  return `ctr_${key.slice(0, 24)}`;
}

export function extractRunId(key: string): string {
  return `cer_${key.slice(0, 24)}`;
}

export function segmentId(runId: string, channel: string, orderIndex: number): string {
  return `seg_${sha(`${runId}:${channel}:${orderIndex}`).slice(0, 24)}`;
}

export function beatId(runId: string, orderIndex: number): string {
  return `abt_${sha(`${runId}:${orderIndex}`).slice(0, 24)}`;
}

export function reportId(parts: string[]): string {
  return `cpr_${sha(parts.join(":")).slice(0, 24)}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
