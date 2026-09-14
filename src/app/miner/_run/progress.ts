// Pure arithmetic behind the run header: how full the bar is, how long is left,
// and what has been spent. Kept out of the components so it can be tested.

import { stageDef } from "./stages";
import type { PipelineRun, StageProgress } from "./types";

/** A stage's own completion, 0..1. Batch stages are all-or-nothing. */
export function stageShare(progress: StageProgress): number {
  if (progress.status === "done" || progress.status === "skipped") return 1;
  if (progress.status === "waiting") return 0;
  if (progress.total <= 0) return progress.status === "running" ? 0 : 1;
  return Math.min(1, progress.settled / progress.total);
}

/**
 * Overall progress, weighted by stage rather than by ad count, so the bar never
 * jumps backwards when a stage's queue turns out bigger than the one before.
 */
export function overallPercent(run: Pick<PipelineRun, "order" | "stages">): number {
  const total = run.order.reduce((sum, key) => sum + stageDef(key).weight, 0);
  if (total <= 0) return 0;
  const done = run.order.reduce((sum, key) => {
    const progress = run.stages[key];
    return sum + (progress ? stageDef(key).weight * stageShare(progress) : 0);
  }, 0);
  return Math.min(1, done / total);
}

export function totalCostUsd(run: Pick<PipelineRun, "stages">): number {
  return Object.values(run.stages).reduce((sum, progress) => sum + (progress?.costUsd ?? 0), 0);
}

export function totals(run: Pick<PipelineRun, "stages">): { settled: number; failed: number; review: number } {
  return Object.values(run.stages).reduce(
    (acc, progress) => progress
      ? { settled: acc.settled + progress.settled, failed: acc.failed + progress.failed, review: acc.review + progress.review }
      : acc,
    { settled: 0, failed: 0, review: 0 },
  );
}

/**
 * Seconds left in the stage now running, from its own observed pace. Null until
 * a few ads have settled — an estimate from one sample is noise, not help.
 */
export function etaSeconds(progress: StageProgress | undefined, now: number, minSamples = 5): number | null {
  if (!progress || progress.status !== "running" || !progress.startedAt) return null;
  const remaining = progress.total - progress.settled;
  if (remaining <= 0 || progress.settled < minSamples) return null;
  const perAd = (now - progress.startedAt) / progress.settled;
  return Math.round((remaining * perAd) / 1000);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
