import assert from "node:assert/strict";
import test from "node:test";
import type { AdTeardownRow, CorpusAdStateRow } from "@/lib/database.types";
import { planTeardown, selectStageRows } from "./queue";

function row(id: string, patch: Partial<CorpusAdStateRow> = {}): CorpusAdStateRow {
  return { id, brandName: "Ionix", mediaType: "video", corpusIncluded: true, winnerScore: null, mediaStatus: null, transcriptStatus: null, extractStatus: null, ...patch } as CorpusAdStateRow;
}

const rows = [
  row("fresh"),
  row("downloaded", { mediaStatus: "downloaded" }),
  row("transcribed", { mediaStatus: "downloaded", transcriptStatus: "complete" }),
  row("extracted", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "complete" }),
  row("review", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "needs_human_review" }),
  row("image", { mediaType: "image" }),
  row("excluded", { corpusIncluded: false }),
  row("other-brand", { brandName: "Luveon" }),
];
const ids = (list: CorpusAdStateRow[]) => list.map((item) => item.id);

test("each stage takes what the previous one finished, videos in scope only", () => {
  assert.deepEqual(ids(selectStageRows("media", rows)), ["fresh", "other-brand"]);
  assert.deepEqual(ids(selectStageRows("transcribe", rows)), ["downloaded"]);
  assert.deepEqual(ids(selectStageRows("extract", rows)), ["transcribed"]);
  assert.deepEqual(ids(selectStageRows("extract", rows, { retryReview: true })), ["transcribed", "review"]);
});

test("force redoes everything in scope; brand and limit narrow it", () => {
  assert.equal(selectStageRows("media", rows, { force: true }).length, 6);
  assert.deepEqual(ids(selectStageRows("media", rows, { brand: "luveon" })), ["other-brand"]);
  assert.deepEqual(ids(selectStageRows("media", rows, { force: true, limit: 2 })), ["fresh", "downloaded"]);
});

test("explicit ids bypass the stage check but not the video scope", () => {
  assert.deepEqual(ids(selectStageRows("transcribe", rows, { ids: ["extracted", "image"] })), ["extracted"]);
});

test("teardown sends the winner cut, retries failures, and leaves running jobs alone", () => {
  const scored = [80, 70, 60, 50, 40, 30, 20, 10].map((score, index) => row(`w${index}`, { winnerScore: score }));
  const teardown = (competitorAdId: string, status: AdTeardownRow["status"]) => ({ competitorAdId, status }) as AdTeardownRow;
  const plan = planTeardown(scored, [teardown("w0", "completed"), teardown("w1", "failed")]);
  assert.deepEqual(ids(plan.winners), ["w0", "w1"]);
  assert.deepEqual(ids(plan.todo), ["w1"]);
  assert.equal(plan.scoredCount, 8);

  const running = planTeardown(scored, [teardown("w0", "processing")], { limit: 3 });
  assert.deepEqual(ids(running.todo), ["w1", "w2"]);
  assert.deepEqual(ids(running.pending), ["w0"]);
  assert.deepEqual(ids(planTeardown(scored, [teardown("w0", "completed")], { force: true }).todo), ["w0", "w1"]);
});
