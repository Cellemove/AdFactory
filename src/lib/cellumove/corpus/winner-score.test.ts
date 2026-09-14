import assert from "node:assert/strict";
import test from "node:test";
import { computeWinnerScore, conceptFingerprint, daysActiveOf, rankLabel, rankWinnerScores } from "./winner-score";

const base = { daysActive: 30, variantCount: 2, placementBreadth: 3, conceptReuse: 1 };

test("score is bounded 0..100 and zero inputs score zero", () => {
  assert.equal(computeWinnerScore({ daysActive: 0, variantCount: 0, placementBreadth: 0, conceptReuse: 0 }).score, 0);
  assert.equal(computeWinnerScore({ daysActive: 10_000, variantCount: 500, placementBreadth: 99, conceptReuse: 99 }).score, 100);
});

test("score is monotone non-decreasing in every input", () => {
  const start = computeWinnerScore(base).score;
  for (const key of Object.keys(base) as Array<keyof typeof base>) {
    const more = computeWinnerScore({ ...base, [key]: base[key] + 1 }).score;
    assert.ok(more >= start, `${key} should not lower the score`);
  }
});

test("days active saturates at 180 and carries the heaviest weight", () => {
  const at180 = computeWinnerScore({ ...base, daysActive: 180 }).score;
  const at400 = computeWinnerScore({ ...base, daysActive: 400 }).score;
  assert.equal(at180, at400);
  const onlyDays = computeWinnerScore({ daysActive: 180, variantCount: 0, placementBreadth: 1, conceptReuse: 0 }).score;
  assert.equal(onlyDays, 55);
});

test("daysActive prefers the provider figure, then the start/end span", () => {
  assert.equal(daysActiveOf({ startedAt: null, endedAt: null, lastSeenAt: "2026-09-10T00:00:00Z", metrics: { totalActiveTimeSec: 86_400 * 3 } }), 3);
  assert.equal(daysActiveOf({ startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-05T00:00:00Z", lastSeenAt: "2026-09-10T00:00:00Z", metrics: {} }), 4);
  assert.equal(daysActiveOf({ startedAt: "2026-09-01T00:00:00Z", endedAt: null, lastSeenAt: "2026-09-10T00:00:00Z", metrics: {} }), 9);
});

test("concept reuse counts same-brand siblings with the same fingerprint only", () => {
  const copy = "Heavy legs by 3pm? These leggings changed my afternoons completely and I mean it";
  const ads = [
    { id: "a", brandName: "Acme", copy, startedAt: null, endedAt: null, lastSeenAt: "2026-09-10T00:00:00Z", metrics: {}, rawPayload: { platforms: ["fb"] } },
    { id: "b", brandName: "Acme", copy: `${copy} — now 20% off`, startedAt: null, endedAt: null, lastSeenAt: "2026-09-10T00:00:00Z", metrics: {}, rawPayload: { platforms: ["fb"] } },
    { id: "c", brandName: "Other", copy, startedAt: null, endedAt: null, lastSeenAt: "2026-09-10T00:00:00Z", metrics: {}, rawPayload: { platforms: ["fb"] } },
  ];
  const scores = rankWinnerScores(ads);
  assert.equal(scores.get("a")?.breakdown.conceptReuse, 1);
  assert.equal(scores.get("b")?.breakdown.conceptReuse, 1);
  assert.equal(scores.get("c")?.breakdown.conceptReuse, 0);
  assert.equal(conceptFingerprint("").length, 0);
});

test("rank label names the proxy", () => {
  assert.equal(rankLabel(3, 40), "Longevity rank #3 of 40");
});
