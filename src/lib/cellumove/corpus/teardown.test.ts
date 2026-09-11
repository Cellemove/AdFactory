import assert from "node:assert/strict";
import test from "node:test";
import type { CorpusAdStateRow } from "@/lib/database.types";
import { defaultWinnerCount, jobToRowPatch, pickWinners, TeardownJobSchema, teardownAdName, teardownCostUsd, teardownSourceFor, workbookHeadlines } from "./teardown";

function row(id: string, winnerScore: number | null, extra: Partial<CorpusAdStateRow> = {}): CorpusAdStateRow {
  return { id, brandName: "b", mediaType: "video", corpusIncluded: true, winnerScore, ...extra } as CorpusAdStateRow;
}

test("winners are the top scored, included videos, best first", () => {
  const rows = [row("a", 40), row("b", 90), row("c", null), row("d", 70, { mediaType: "image" }), row("e", 80, { corpusIncluded: false }), row("f", 60)];
  assert.deepEqual(pickWinners(rows, 2).map((r) => r.id), ["b", "f"]);
  assert.deepEqual(pickWinners(rows, 10).map((r) => r.id), ["b", "f", "a"]);
});

test("the default cut is the top quartile, never zero", () => {
  assert.equal(defaultWinnerCount(41), 11);
  assert.equal(defaultWinnerCount(8), 2);
  assert.equal(defaultWinnerCount(1), 1);
  assert.equal(defaultWinnerCount(0), 1);
});

test("a live provider link wins; an expired one falls back to the stored copy", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const ad = { mediaType: "video", videoUrl: "https://x/hd.mp4", rawPayload: { video_sd_url: "https://x/sd.mp4" }, mediaExpiresAt: "2026-09-12T00:00:00Z" };
  const media = { status: "downloaded", storagePath: "cad_a/abc.mp4", localPath: null, mime: "video/mp4", bytes: 10, sha256: "abc" };
  assert.deepEqual(teardownSourceFor(ad, media, now), { kind: "url", url: "https://x/sd.mp4", sourceKind: "video_sd_url" });
  const expired = { ...ad, mediaExpiresAt: "2026-09-10T00:00:00Z" };
  assert.deepEqual(teardownSourceFor(expired, media, now), { kind: "stored", mime: "video/mp4", bytes: 10, sha256: "abc" });
  assert.equal(teardownSourceFor(expired, { ...media, storagePath: null }, now), null);
  assert.equal(teardownSourceFor(expired, { ...media, status: "failed" }, now), null);
  assert.equal(teardownSourceFor(expired, null, now), null);
});

const workbook = {
  title: "THE WINNING AD DECONSTRUCTION WORKBOOK",
  sections: [{ key: "part_12", title: "PART 12: SUCCESS FACTORS", field_keys: ["one", "hook"] }],
  fields: [
    { key: "one", label: "The ONE Thing That Makes This Work", value: "Pain feels seen.", section: "PART 12: SUCCESS FACTORS", ordinal: 1 },
    { key: "stage", label: "Market Awareness Stage", value: "[Choose ONE and explain]", section: "PART 1: AVATAR", ordinal: 2 },
    { key: "pain", label: "Primary Pain Point", value: "Nighttime sciatica.", section: "PART 3: PROBLEM", ordinal: 3 },
  ],
};

test("job records map onto the mirror; errors only survive on failed jobs", () => {
  const done = TeardownJobSchema.parse({ id: "u1", status: "completed", parsed_output: workbook, raw_output: "raw", prompt_tokens: 60_000, output_tokens: 12_000, error_code: "stale", sheet_row_link: "https://s", completed_at: "2026-09-11T01:00:00Z", extra: 1 });
  const patch = jobToRowPatch(done);
  assert.equal(patch.status, "completed");
  assert.equal(patch.errorCode, null);
  assert.equal(patch.sheetRowLink, "https://s");
  assert.equal(patch.promptTokens, 60_000);
  const failed = jobToRowPatch(TeardownJobSchema.parse({ id: "u2", status: "failed", error_message: "boom" }));
  assert.equal(failed.errorCode, "failed");
  assert.equal(failed.errorMessage, "boom");
});

test("cost uses Gemini 2.5 Pro list price and needs both token counts", () => {
  assert.equal(teardownCostUsd({ promptTokens: 60_000, outputTokens: 12_000 })?.toFixed(3), "0.195");
  assert.equal(teardownCostUsd({ promptTokens: 60_000, outputTokens: null }), null);
});

test("headlines skip placeholder echoes and missing labels", () => {
  assert.deepEqual(workbookHeadlines(workbook), [
    { label: "The ONE Thing That Makes This Work", value: "Pain feels seen." },
    { label: "Primary Pain Point", value: "Nighttime sciatica." },
  ]);
  assert.deepEqual(workbookHeadlines({ nope: true }), []);
});

test("ad names respect Teardown's 160-character cap", () => {
  assert.equal(teardownAdName({ brandName: "Ionix", externalId: "123" }), "Ionix · 123");
  assert.equal(teardownAdName({ brandName: "x".repeat(200), externalId: "1" }).length, 160);
});
