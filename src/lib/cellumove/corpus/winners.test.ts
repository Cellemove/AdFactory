import assert from "node:assert/strict";
import test from "node:test";
import { balancedTrim, brandsToExtend, fairShare, launchedWithin, pageSizeFor, pickNew, readWinnerPick, resolveCompetitors, teardownSkipReason, winnerCutoff } from "./winners";

test("the cutoff is today minus the minimum run, as a UTC date", () => {
  assert.equal(winnerCutoff(Date.parse("2026-09-11T20:00:00Z"), 21), "2026-08-21");
});

test("each brand's share covers the target", () => {
  assert.equal(fairShare(100, 21), 5);
  assert.equal(fairShare(100, 100), 1);
  assert.equal(fairShare(100, 0), 0);
});

test("a shortfall is filled by the brands with the most winners left, one page each", () => {
  const brands = [
    { domain: "a.com", fetched: 5, total: 40, exhausted: false },
    { domain: "b.com", fetched: 5, total: 12, exhausted: false },
    { domain: "c.com", fetched: 2, total: 2, exhausted: true },
    { domain: "d.com", fetched: 5, total: null, exhausted: false },
  ];
  assert.deepEqual(brandsToExtend(brands, 7, 5), ["d.com", "a.com"]);
  assert.deepEqual(brandsToExtend(brands, 0, 5), []);
  assert.deepEqual(brandsToExtend([{ domain: "c.com", fetched: 2, total: 2, exhausted: true }], 10, 5), []);
});

test("trimming drops the lowest-spend ad from the biggest brand first", () => {
  const pool = new Map([
    ["a", [90, 80, 70, 60]],
    ["b", [50, 40]],
    ["c", [100, 5, 4]],
  ]);
  const trimmed = balancedTrim(pool, 6, (spend) => spend);
  assert.deepEqual(Object.fromEntries(trimmed), { a: [90, 80], b: [50, 40], c: [100, 5] });
  assert.deepEqual(pool.get("a"), [90, 80, 70, 60], "input is not mutated");
  assert.equal([...balancedTrim(pool, 100, (spend) => spend).values()].flat().length, 9);
});

test("recent launch window includes UTC dates 7 through 30 and rejects missing or invalid dates", () => {
  const now = Date.parse("2026-09-18T12:30:00Z");
  for (const [date, expected] of [["2026-09-12", false], ["2026-09-11T23:59:59Z", true], ["2026-08-19T00:00:00Z", true], ["2026-08-18", false], [null, false], ["invalid", false], ["2026-09-19", false]] as const) {
    assert.equal(launchedWithin(date, now, 7, 30), expected, String(date));
  }
});

test("new picks exclude all previous work, balance and interleave without mutating inputs", () => {
  const pool = new Map([["a", [100, 90, 80, 70]], ["b", [60, 50, 40]], ["c", [30, 20]]]);
  const before = structuredClone(pool);
  const done = new Set(["100", "50"]);
  const picked = pickNew(pool, done, 6, String, Number);
  assert.deepEqual(picked, [90, 60, 30, 80, 40, 20]);
  assert.deepEqual(pool, before);
  assert.deepEqual([...done], ["100", "50"]);
  assert.deepEqual(pickNew(pool, done, 0, String, Number), []);
  assert.equal(pickNew(pool, done, 100, String, Number).length, 7);
});

test("new picks deduplicate across brands and prefer spend within a brand", () => {
  const pool = new Map([["a", [2, 4, 4]], ["b", [4, 3]], ["empty", []]]);
  assert.deepEqual(pickNew(pool, new Set(), 2, String, Number), [4, 3]);
  assert.deepEqual(pickNew(pool, new Set(["2", "3", "4"]), 2, String, Number), []);
});


test("page size never exceeds the provider's 100-row cap", () => {
  assert.equal(pageSizeFor(100, 21), 5);
  assert.equal(pageSizeFor(100, 1), 100);
  // Without the clamp a single-brand pull asks for 200, gets 100, and is wrongly
  // marked exhausted after the first page.
  assert.equal(pageSizeFor(200, 1), 100);
  assert.equal(pageSizeFor(500, 3), 100);
});

const tracked = [{ domain: "getionix.com", name: "Ionix" }, { domain: "luveon.com", name: "Luveon" }];

test("a brand resolves to one competitor, by domain or name, any case", () => {
  assert.deepEqual(resolveCompetitors(tracked, "GetIonix.com"), [tracked[0]]);
  assert.deepEqual(resolveCompetitors(tracked, " luveon "), [tracked[1]]);
  assert.deepEqual(resolveCompetitors(tracked, "Ionix"), [tracked[0]]);
  assert.deepEqual(resolveCompetitors(tracked, null), tracked);
  assert.deepEqual(resolveCompetitors(tracked, "  "), tracked);
});

test("an untracked brand fails loudly, listing what is tracked", () => {
  assert.throws(() => resolveCompetitors(tracked, "nope.com"), /not tracked.*getionix\.com, luveon\.com/s);
});

test("winner picks are read back, and rubbish is rejected", () => {
  const pick = { ruleVersion: "winners-v1", rule: "r", minDays: 21, cutoff: "2026-08-21", brand: "luveon.com", brandRank: 7, target: 100, pickedAt: "2026-09-11T00:00:00Z" };
  assert.deepEqual(readWinnerPick(pick), pick);
  assert.equal(readWinnerPick({ brand: "x" }), null, "a pick without pickedAt is not a pick");
  assert.equal(readWinnerPick(null), null);
  assert.equal(readWinnerPick("nope"), null);
});

test("teardown pre-filter skips only flagged duplicates and out-of-range durations", () => {
  const ad = (over: Partial<{ durationSec: number | null; is_duplicate: boolean | null }>) => ({
    durationSec: "durationSec" in over ? over.durationSec! : 30,
    rawPayload: { is_duplicate: over.is_duplicate ?? false },
  });
  assert.equal(teardownSkipReason(ad({})), null);
  assert.equal(teardownSkipReason(ad({ durationSec: null })), null);
  assert.equal(teardownSkipReason(ad({ is_duplicate: true })), "duplicate creative");
  assert.match(teardownSkipReason(ad({ durationSec: 6 })) ?? "", /outside/);
  assert.match(teardownSkipReason(ad({ durationSec: 300 })) ?? "", /outside/);
});
