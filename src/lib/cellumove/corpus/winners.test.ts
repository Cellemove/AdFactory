import assert from "node:assert/strict";
import test from "node:test";
import { balancedTrim, brandsToExtend, fairShare, pageSizeFor, readWinnerPick, resolveCompetitors, winnerCutoff } from "./winners";

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
