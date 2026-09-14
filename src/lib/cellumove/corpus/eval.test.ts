import assert from "node:assert/strict";
import test from "node:test";
import { compareBeats, goldToPseudoTranscript, lcsLength, summarizeEval } from "./eval";
import { gateBeats } from "./evidence-gate";

test("a perfect decomposition scores 1 on every axis", () => {
  const gold = [{ orderIndex: 0, layer: "H", code: "H_OPENING" }, { orderIndex: 1, layer: "P", code: "P_PROBLEM" }, { orderIndex: 2, layer: "O", code: "O_CTA" }];
  const result = compareBeats(gold, gold);
  assert.equal(result.layerAgreement, 1);
  assert.equal(result.codeAgreement, 1);
  assert.equal(result.orderAgreement, 1);
  assert.deepEqual(result.confusion, {});
});

test("a swapped pair lowers order agreement and a wrong layer shows in the confusion table", () => {
  const gold = [{ orderIndex: 0, layer: "H", code: "H_OPENING" }, { orderIndex: 1, layer: "P", code: "P_PROBLEM" }, { orderIndex: 2, layer: "O", code: "O_CTA" }];
  const swapped = [{ orderIndex: 0, layer: "P", code: "P_PROBLEM" }, { orderIndex: 1, layer: "H", code: "H_OPENING" }, { orderIndex: 2, layer: "O", code: "O_CTA" }];
  const result = compareBeats(gold, swapped);
  assert.ok(result.orderAgreement! < 1);
  assert.ok(result.layerAgreement < 1);
  assert.equal(result.confusion["H→P"], 1);
  assert.equal(lcsLength(["a", "b", "c"], ["b", "c"]), 2);
});

test("the pseudo transcript keeps gold evidence quotes gating at 100", () => {
  const script = "Stop scrolling if your legs feel heavy by 3pm. I used to think it was just my job! Tap below and try them for thirty days.";
  const pseudo = goldToPseudoTranscript(script, 12);
  assert.equal(pseudo.segments.length, 3);
  assert.equal(pseudo.synthetic, false);
  assert.equal(pseudo.durationSec, 12);
  assert.equal(pseudo.segments[2]?.tEnd, 12);
  const gate = gateBeats([{ orderIndex: 0, evidenceQuote: "just my job", channel: "vo", tStart: pseudo.segments[1]!.tStart, tEnd: pseudo.segments[1]!.tEnd }], pseudo.segments, { transcriptEnd: 12 });
  assert.equal(gate.ok, true, gate.errors.join(" "));
  assert.equal(gate.perBeat[0]?.matchScore, 100);
  const synthetic = goldToPseudoTranscript("one two three four five six seven eight nine ten.", null);
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.durationSec, 5);
});

test("quarantined ads count as zero agreement in the summary", () => {
  const summary = summarizeEval([
    { externalId: "a", title: "A", quarantined: false, error: null, attempts: 1, comparison: { layerAgreement: 1, codeAgreement: 0.5, orderAgreement: 1, goldLayers: [], predictedLayers: [], goldCodes: [], predictedCodes: [], confusion: { "P→Q": 2 } } },
    { externalId: "b", title: "B", quarantined: true, error: "gate", attempts: 2, comparison: null },
  ]);
  assert.equal(summary.goldAdCount, 2);
  assert.equal(summary.quarantined, 1);
  assert.equal(summary.layerAgreement, 0.5);
  assert.equal(summary.codeAgreement, 0.25);
  assert.equal(summary.orderAgreement, 1);
  assert.equal(summary.confusion["P→Q"], 2);
  assert.equal(summary.worst[0]?.externalId, "b");
});
