// Stage timing model + the console table and JSON artifact for the end-to-end
// baseline. Kept apart from run.ts so the reporting shape can change without
// touching the orchestration, and so the artifact type is the single definition
// of what a run means.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type StageStatus = "ok" | "skipped" | "blocked" | "failed";

export interface UsageRollup {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  byFeature: Record<string, { calls: number; costUsd: number }>;
}

export interface SubStageResult {
  name: string;
  ms: number;
  note?: string;
}

export interface StageResult {
  name: string;
  status: StageStatus;
  startedAtIso: string;
  ms: number;
  /** One-line human summary shown in the table. */
  summary?: string;
  error?: string;
  notes?: Record<string, unknown>;
  subStages?: SubStageResult[];
  usage?: UsageRollup;
}

export interface LedgerEntry {
  table: string;
  /** Column to match on when cleaning up — "id" for owned rows, a FK otherwise. */
  column: string;
  value: string;
  owned: boolean;
  note?: string;
}

export interface BaselineRun {
  startedAtIso: string;
  finishedAtIso: string;
  /** Everything after preflight — the headline idea -> shipped number. */
  totalMs: number;
  /** Every stage including preflight. */
  wallMs: number;
  flags: Record<string, unknown>;
  /** Presence booleans only. Never the values. */
  env: Record<string, boolean>;
  versions: { node: string; gitSha: string | null; models: Record<string, string> };
  stages: StageResult[];
  usage: UsageRollup;
  warnings: string[];
  ledger: LedgerEntry[];
  projectId: string | null;
  document: unknown;
}

export function emptyUsage(): UsageRollup {
  return { calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, byFeature: {} };
}

export function addUsage(target: UsageRollup, source: UsageRollup): UsageRollup {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.thinkingTokens += source.thinkingTokens;
  target.costUsd += source.costUsd;
  for (const [feature, value] of Object.entries(source.byFeature)) {
    const current = target.byFeature[feature] ?? { calls: 0, costUsd: 0 };
    current.calls += value.calls;
    current.costUsd += value.costUsd;
    target.byFeature[feature] = current;
  }
  return target;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

const NAME_WIDTH = 20;
const TIME_WIDTH = 9;

export function renderReport(run: BaselineRun): string {
  const lines: string[] = [""];

  for (const stage of run.stages) {
    const time = stage.status === "skipped" ? "--" : formatSeconds(stage.ms);
    lines.push(
      `  ${stage.name.padEnd(NAME_WIDTH)}${time.padStart(TIME_WIDTH)}  ${stage.status.padEnd(8)}${stage.summary ?? stage.error ?? ""}`,
    );
    for (const sub of stage.subStages ?? []) {
      lines.push(
        `      ${sub.name.padEnd(NAME_WIDTH - 4)}${formatSeconds(sub.ms).padStart(TIME_WIDTH)}         ${sub.note ?? ""}`.trimEnd(),
      );
    }
  }

  const blocked = run.stages.filter((stage) => stage.status === "blocked" || stage.status === "failed");
  const banner = blocked.length > 0 ? `      [${blocked[0]?.status.toUpperCase()} at ${blocked[0]?.name}]` : "";

  // "AI wall time" = stages that actually produced Usage rows. Defining it from
  // observed model calls rather than a hardcoded stage list keeps it honest when
  // a stage is skipped or a call fails before it bills.
  const aiMs = run.stages
    .filter((stage) => (stage.usage?.calls ?? 0) > 0)
    .reduce((sum, stage) => sum + stage.ms, 0);
  const aiShare = run.totalMs > 0 ? ((aiMs / run.totalMs) * 100).toFixed(1) : "0.0";

  lines.push("");
  lines.push(`  TOTAL (idea -> shipped)  ${formatSeconds(run.totalMs).padStart(9)}  /  ${formatClock(run.totalMs)}${banner}`);
  lines.push(`  AI wall time             ${formatSeconds(aiMs).padStart(9)}  (${aiShare}%)`);
  lines.push(
    `  Gemini spend             ${`$${run.usage.costUsd.toFixed(2)}`.padStart(9)}  ` +
      `${run.usage.calls} calls · in ${formatTokens(run.usage.inputTokens)} / out ${formatTokens(run.usage.outputTokens)} / thinking ${formatTokens(run.usage.thinkingTokens)}`,
  );

  const ranked = run.stages
    .filter((stage) => stage.status !== "skipped" && stage.name !== "preflight" && stage.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6);
  if (ranked.length > 0 && run.totalMs > 0) {
    lines.push("");
    lines.push("  Where the time goes");
    for (const stage of ranked) {
      const share = ((stage.ms / run.totalMs) * 100).toFixed(1).padStart(5);
      lines.push(`    ${share}%  ${stage.name.padEnd(NAME_WIDTH)}${formatSeconds(stage.ms).padStart(TIME_WIDTH)}`);
    }
  }

  if (run.warnings.length > 0) {
    lines.push("");
    lines.push(`  ${run.warnings.length} warning(s) captured during the run:`);
    for (const warning of run.warnings.slice(0, 8)) {
      lines.push(`    - ${warning.length > 140 ? `${warning.slice(0, 137)}...` : warning}`);
    }
    if (run.warnings.length > 8) lines.push(`    ... ${run.warnings.length - 8} more in the artifact`);
  }

  lines.push("");
  lines.push("  This is the machine floor, not the true idea -> shipped time. It excludes");
  lines.push("  every human step: choosing the angle, reading and judging drafts, picking");
  lines.push("  the framework, editing copy, and review round-trips.");
  lines.push("");

  return lines.join("\n");
}

export async function writeArtifact(run: BaselineRun, explicitPath: string | null): Promise<string> {
  const stamp = run.startedAtIso.replace(/[:.]/g, "-");
  const target = explicitPath ?? path.join(process.cwd(), "backups", "baseline", `baseline-${stamp}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  const body = `${JSON.stringify(run, null, 2)}\n`;
  await writeFile(target, body, "utf8");
  if (!explicitPath) {
    // A stable path to diff against, so a run can be compared without hunting
    // for the last stamp.
    await writeFile(path.join(path.dirname(target), "latest.json"), body, "utf8");
  }
  return target;
}
