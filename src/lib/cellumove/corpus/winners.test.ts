import assert from "node:assert/strict";
import test from "node:test";
import { balancedTrim, brandsToExtend, fairShare, winnerCutoff } from "./winners";

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
