import assert from "node:assert/strict";
import test from "node:test";
import type { AdTeardownRow, CorpusAdStateRow } from "@/lib/database.types";
import { brandSummaries, findBrandSummary } from "./brand-progress";

function ad(brandName: string, patch: Partial<CorpusAdStateRow> = {}): CorpusAdStateRow {
  return {
    id: `cad_${brandName}_${Math.random().toString(36).slice(2, 8)}`,
    brandName, mediaType: "video", corpusIncluded: true, winnerScore: null,
    mediaStatus: null, transcriptStatus: null, extractStatus: null, hasVideoUrl: true, mediaExpiresAt: null,
    ...patch,
  } as CorpusAdStateRow;
}

const tracked = [{ domain: "luveon.com", name: "Luveon" }, { domain: "getionix.com", name: "Ionix" }];

test("a tracked competitor with nothing collected still gets a row, so the rail is a to-do list", () => {
  const summaries = brandSummaries([], tracked, []);
  assert.deepEqual(summaries.map((item) => item.domain).sort(), ["getionix.com", "luveon.com"]);
  assert.equal(summaries[0]!.state, "untouched");
  assert.equal(summaries[0]!.percent, 0);
});

test("progress counts each stage and never exceeds 100%", () => {
  const rows = [
    ad("luveon.com", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "complete", winnerScore: 80 }),
    ad("luveon.com", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "complete", winnerScore: 70 }),
  ];
  const [luveon] = brandSummaries(rows, [tracked[0]!], []);
  assert.equal(luveon!.inCorpus, 2);
  assert.equal(luveon!.extracted, 2);
  assert.equal(luveon!.percent, 1);
  assert.equal(luveon!.state, "ready");
});

test("ads needing review or failing flag the brand for attention", () => {
  const rows = [
    ad("luveon.com", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "complete" }),
    ad("luveon.com", { mediaStatus: "downloaded", transcriptStatus: "complete", extractStatus: "needs_human_review" }),
    ad("luveon.com", { mediaStatus: "oversize" }),
  ];
  const [luveon] = brandSummaries(rows, [tracked[0]!], []);
  assert.equal(luveon!.needsReview, 1);
  assert.equal(luveon!.failed, 1);
  assert.equal(luveon!.state, "attention");
  assert.ok(luveon!.percent > 0 && luveon!.percent < 1);
});

test("a brand dropped from Spectre still surfaces while it holds corpus ads", () => {
  const summaries = brandSummaries([ad("gone.example")], tracked, []);
  const gone = findBrandSummary(summaries, "gone.example");
  assert.equal(gone?.tracked, false);
  assert.equal(gone?.inCorpus, 1);
  assert.equal(findBrandSummary(summaries, "luveon.com")?.tracked, true);
  assert.equal(findBrandSummary(summaries, null), null);
});

test("pick time and link expiry come from the ads waiting to be downloaded", () => {
  const rows = [
    ad("luveon.com", { winnerPick: { brand: "luveon.com", pickedAt: "2026-09-10T00:00:00Z" }, mediaExpiresAt: "2026-09-14T00:00:00Z" }),
    ad("luveon.com", { winnerPick: { brand: "luveon.com", pickedAt: "2026-09-12T00:00:00Z" }, mediaExpiresAt: "2026-09-16T00:00:00Z" }),
    // Already downloaded: its link no longer matters.
    ad("luveon.com", { mediaStatus: "downloaded", mediaExpiresAt: "2026-09-13T00:00:00Z" }),
  ];
  const [luveon] = brandSummaries(rows, [tracked[0]!], []);
  assert.equal(luveon!.lastPickedAt, "2026-09-12T00:00:00Z");
  assert.equal(luveon!.linksExpireAt, "2026-09-14T00:00:00Z");
});

test("teardowns are counted per brand", () => {
  const done = ad("luveon.com", { mediaStatus: "downloaded" });
  const pending = ad("luveon.com", { mediaStatus: "downloaded" });
  const teardowns = [
    { competitorAdId: done.id, status: "completed" },
    { competitorAdId: pending.id, status: "processing" },
  ] as AdTeardownRow[];
  const [luveon] = brandSummaries([done, pending], [tracked[0]!], teardowns);
  assert.equal(luveon!.teardownsDone, 1);
  assert.equal(luveon!.teardownsPending, 1);
});
