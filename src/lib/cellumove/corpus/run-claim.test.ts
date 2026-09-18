import assert from "node:assert/strict";
import test from "node:test";
import { claimRun, RunInProgressError, RUN_STALE_AFTER_MS, type ClaimState } from "./run-claim";

test("overlapping callers cannot own the same new run", async () => {
  let row: ClaimState | null = null;
  const store = {
    async insert() {
      if (row) return { error: { code: "23505", message: "duplicate" } };
      row = { status: "running", startedAt: "first" };
      return { error: null };
    },
    async load() { return row!; },
    async retry() { throw new Error("must not retry active work"); },
  };
  const results = await Promise.allSettled([claimRun(store), claimRun(store)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof RunInProgressError);
});

test("retry ownership uses a conditional update and preserves completed results", async () => {
  let row: ClaimState = { status: "failed", startedAt: "old" };
  const store = {
    async insert() { return { error: { code: "23505", message: "duplicate" } }; },
    async load() { return { ...row }; },
    async retry(previous: ClaimState) {
      if (row.status !== previous.status || row.startedAt !== previous.startedAt) return false;
      row = { status: "running", startedAt: "new" };
      return true;
    },
  };
  const results = await Promise.allSettled([claimRun(store), claimRun(store)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  row.status = "complete";
  assert.equal(await claimRun(store), false);
  assert.equal(row.status, "complete");
  row.status = "needs_human_review";
  assert.equal(await claimRun(store), false);
  assert.equal(await claimRun(store, true), true);
});

test("a run abandoned mid-flight can be taken over, but only once and only when stale", async () => {
  const startedAt = new Date("2026-09-15T10:00:00.000Z").toISOString();
  let row: ClaimState = { status: "running", startedAt };
  const store = {
    async insert() { return { error: { code: "23505", message: "duplicate" } }; },
    async load() { return { ...row }; },
    async retry(previous: ClaimState) {
      if (row.status !== previous.status || row.startedAt !== previous.startedAt) return false;
      row = { status: "running", startedAt: new Date("2026-09-15T12:00:00.000Z").toISOString() };
      return true;
    },
  };
  const live = Date.parse(startedAt) + RUN_STALE_AFTER_MS - 1;
  await assert.rejects(claimRun(store, false, live), RunInProgressError);
  assert.equal(row.startedAt, startedAt, "a live run keeps its claim");

  const stale = Date.parse(startedAt) + RUN_STALE_AFTER_MS + 1;
  const results = await Promise.allSettled([claimRun(store, false, stale), claimRun(store, false, stale)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "only one caller takes over");
});
