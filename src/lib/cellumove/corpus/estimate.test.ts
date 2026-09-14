import assert from "node:assert/strict";
import test from "node:test";
import { estimateRun, formatMinutes, formatUsd, formatUsdRange } from "./estimate";

test("collecting is what costs credits; reusing what is already there does not", () => {
  assert.equal(estimateRun({ ads: 100, includeCollect: true }).credits, 100);
  assert.equal(estimateRun({ ads: 100, includeCollect: false }).credits, 0);
});

test("model spend and time scale with the number of ads", () => {
  const hundred = estimateRun({ ads: 100, includeCollect: true });
  const fifty = estimateRun({ ads: 50, includeCollect: true });
  assert.ok(hundred.usdLow > fifty.usdLow && hundred.usdHigh > fifty.usdHigh);
  assert.ok(hundred.usdLow < hundred.usdHigh, "the range is a range");
  assert.ok(hundred.minutesLow < hundred.minutesHigh);
  assert.ok(hundred.minutesLow >= 1, "never promises zero minutes");
});

test("an empty run still reads sensibly", () => {
  const none = estimateRun({ ads: 0, includeCollect: false });
  assert.equal(none.credits, 0);
  assert.equal(none.usdLow, 0);
  assert.ok(none.minutesLow >= 1);
});

test("money and time are formatted for humans", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.004), "<$0.01");
  assert.equal(formatUsd(3.456), "$3.46");
  assert.equal(formatUsdRange(1, 1), "$1.00");
  assert.equal(formatUsdRange(1, 2.5), "$1.00-$2.50".replace("-", "\u2013"));
  assert.equal(formatMinutes(5, 5), "5 min");
  assert.equal(formatMinutes(5, 12), "5\u201312 min");
});
