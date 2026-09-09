import assert from "node:assert/strict";
import test from "node:test";
import { validateGoldSetImport } from "./gold-set-import";

const codes = new Map([["H_OPENING", "H"], ["O_CTA", "O"], ["OTHER", "OTHER"]] as const);

test("accepts a normalized gold ad with exact evidence quotes", () => {
  const report = validateGoldSetImport([{
    externalId: "gold-1", title: "Gold 1", angleSlug: "relief", format: "UGC", scriptText: "Stop scrolling. Try it today.",
    beats: [
      { orderIndex: 0, layer: "H", code: "H_OPENING", evidenceQuote: "Stop scrolling." },
      { orderIndex: 1, layer: "O", code: "O_CTA", evidenceQuote: "Try it today." },
    ],
  }], codes);
  assert.equal(report.accepted.length, 1);
  assert.equal(report.rejected.length, 0);
});

test("rejects duplicate ids, unknown codes, changed quotes, and unexplained OTHER", () => {
  const row = {
    externalId: "gold-1", title: "Gold 1", angleSlug: "relief", format: "UGC", scriptText: "Stop scrolling.",
    beats: [{ orderIndex: 0, layer: "OTHER", code: "UNKNOWN", evidenceQuote: "Changed text" }],
  };
  const report = validateGoldSetImport([row, row], codes);
  assert.equal(report.accepted.length, 0);
  assert.match(report.rejected[0]!.errors.join(" "), /duplicated/);
  assert.match(report.rejected[0]!.errors.join(" "), /Unknown taxonomy code/);
  assert.match(report.rejected[0]!.errors.join(" "), /exact script substring/);
  assert.match(report.rejected[0]!.errors.join(" "), /otherExplanation/);
});
