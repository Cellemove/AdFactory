import assert from "node:assert/strict";
import test from "node:test";
import { etaSeconds, overallPercent, stageShare, totalCostUsd, totals } from "./progress";
import type { PipelineRun, StageKey, StageProgress } from "./types";

function progress(key: StageKey, patch: Partial<StageProgress> = {}): StageProgress {
  return { key, status: "waiting", total: 0, settled: 0, failed: 0, review: 0, costUsd: 0, ...patch };
}

const order: StageKey[] = ["ingest", "media", "transcribe", "extract", "score", "mine"];

function run(stages: Partial<Record<StageKey, StageProgress>>): Pick<PipelineRun, "order" | "stages"> {
  return { order, stages };
}

test("a stage's share follows its settled ads, and batch stages are all or nothing", () => {
  assert.equal(stageShare(progress("media", { status: "running", total: 10, settled: 4 })), 0.4);
  assert.equal(stageShare(progress("ingest", { status: "done" })), 1);
  assert.equal(stageShare(progress("media", { status: "skipped" })), 1, "nothing to do still counts as complete");
  assert.equal(stageShare(progress("media", { status: "waiting", total: 10 })), 0);
});

test("overall progress is weighted by stage and never goes backwards when a queue grows", () => {
  const afterCollect = overallPercent(run({ ingest: progress("ingest", { status: "done" }) }));
  const midTranscribe = overallPercent(run({
    ingest: progress("ingest", { status: "done" }),
    media: progress("media", { status: "done" }),
    transcribe: progress("transcribe", { status: "running", total: 10, settled: 5 }),
  }));
  assert.ok(afterCollect > 0 && afterCollect < 0.1 + 1e-9);
  assert.ok(midTranscribe > afterCollect);

  // The same stage with twice the queue and twice the settled ads sits at the same point.
  const doubled = overallPercent(run({
    ingest: progress("ingest", { status: "done" }),
    media: progress("media", { status: "done" }),
    transcribe: progress("transcribe", { status: "running", total: 20, settled: 10 }),
  }));
  assert.equal(doubled, midTranscribe);
  assert.equal(overallPercent(run(Object.fromEntries(order.map((key) => [key, progress(key, { status: "done" })])))), 1);
});

test("cost and counts roll up across stages", () => {
  const state = run({
    transcribe: progress("transcribe", { status: "done", total: 3, settled: 3, costUsd: 0.12 }),
    extract: progress("extract", { status: "running", total: 3, settled: 2, failed: 1, review: 1, costUsd: 0.08 }),
  });
  assert.equal(Math.round(totalCostUsd(state) * 100) / 100, 0.2);
  assert.deepEqual(totals(state), { settled: 5, failed: 1, review: 1 });
});

test("the ETA waits for a few ads before guessing, and only while a stage runs", () => {
  const started = 1_000_000;
  const running = progress("transcribe", { status: "running", total: 10, settled: 5, startedAt: started });
  // 5 ads in 50s = 10s each, 5 left.
  assert.equal(etaSeconds(running, started + 50_000), 50);
  assert.equal(etaSeconds({ ...running, settled: 2 }, started + 20_000), null, "two ads is not a pace");
  assert.equal(etaSeconds({ ...running, settled: 10 }, started + 100_000), null, "nothing left to wait for");
  assert.equal(etaSeconds(progress("transcribe", { status: "done" }), started), null);
  assert.equal(etaSeconds(undefined, started), null);
});
