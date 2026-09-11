import assert from "node:assert/strict";
import test from "node:test";
import type { ScorerLayer } from "@/lib/cellumove/script-scorer";
import { ExtractValidationError, buildExtractPrompt, isOtherCode, validateExtractedBeats } from "./extract";

const allowedCodes = new Map<string, ScorerLayer>([["H_OPENING", "H"], ["P_PROBLEM", "P"], ["O_CTA", "O"], ["OTHER", "OTHER"], ["M_OTHER", "M"]]);
const segments = [
  { id: "vo0", channel: "vo" as const, orderIndex: 0, tStart: 0, tEnd: 2.4, text: "Stop scrolling if your legs feel heavy by 3pm.", confidence: null },
  { id: "vo1", channel: "vo" as const, orderIndex: 1, tStart: 2.4, tEnd: 6, text: "Tap below and try them for thirty days.", confidence: null },
];
const good = {
  format: "ugc",
  beats: [
    { order_index: 0, layer: "H", code: "H_OPENING", t_start: 0, t_end: 2.4, evidence_quote: "Stop scrolling if your legs feel heavy", channel: "vo" },
    { order_index: 1, layer: "O", code: "O_CTA", t_start: 2.4, t_end: 6, evidence_quote: "Tap below and try them", channel: "vo" },
  ],
};

function rejects(raw: unknown, pattern: RegExp, code?: string) {
  try {
    validateExtractedBeats({ raw, allowedCodes, segments, transcriptEnd: 6 });
    assert.fail("expected a validation error");
  } catch (error) {
    assert.ok(error instanceof ExtractValidationError, String(error));
    assert.match(error.message, pattern);
    if (code) assert.equal(error.code, code);
  }
}

test("a faithful response validates, normalises the format and carries match scores", () => {
  const result = validateExtractedBeats({ raw: good, allowedCodes, segments, transcriptEnd: 6 });
  assert.equal(result.format, "UGC");
  assert.equal(result.beats.length, 2);
  assert.equal(result.beats[0]?.matchScore, 100);
  assert.equal(result.beats[0]?.matchedSegmentId, "vo0");
  assert.equal(result.beats[1]?.code, "O_CTA");
});

test("schema failures name the field", () => {
  rejects({ beats: "nope" }, /Response shape is invalid at beats/, "SCHEMA");
  rejects({ beats: [{ ...good.beats[0], channel: "voice" }] }, /channel/, "SCHEMA");
});

test("order, taxonomy membership, layer pairing and OTHER explanations are enforced", () => {
  rejects({ beats: [good.beats[0], { ...good.beats[1], order_index: 5 }] }, /order_index values must be 0..1/, "SCHEMA");
  rejects({ beats: [{ ...good.beats[0], code: "H_INVENTED" }] }, /unknown taxonomy code "H_INVENTED"/, "SCHEMA");
  rejects({ beats: [{ ...good.beats[0], code: "P_PROBLEM" }] }, /belongs to layer P/, "SCHEMA");
  rejects({ beats: [{ ...good.beats[0], layer: "M", code: "M_OTHER" }] }, /without other_explanation/, "SCHEMA");
  assert.equal(isOtherCode("M_OTHER", "M"), true);
  assert.equal(isOtherCode("OTHER", "OTHER"), true);
  assert.equal(isOtherCode("H_OPENING", "H"), false);
});

test("the evidence gate and timecodes are enforced with their own error codes", () => {
  rejects({ beats: [{ ...good.beats[0], evidence_quote: "clinically proven circulation booster" }] }, /not a near-exact transcript substring/, "EVIDENCE_GATE");
  rejects({ beats: [{ ...good.beats[0], t_start: 4, t_end: 30 }] }, /transcript ends at 6s/, "TIMECODE");
});

test("unknown formats fall back to Other and the prompt only carries the retry block when asked", () => {
  const result = validateExtractedBeats({ raw: { ...good, format: "Hologram" }, allowedCodes, segments, transcriptEnd: 6 });
  assert.equal(result.format, "Other");
  const base = { taxonomyVersion: "copy-taxonomy-v1", taxonomy: [{ code: "H_OPENING", layer: "H", label: "Opening hook", description: "x" }], transcriptText: "[vo 0.0-2.4] hi", durationSec: 2.4, language: "en" };
  assert.doesNotMatch(buildExtractPrompt(base), /previous response failed/);
  assert.match(buildExtractPrompt({ ...base, previousError: "Beat 0 is wrong." }), /previous response failed validation: Beat 0 is wrong\./);
  assert.match(buildExtractPrompt({ ...base, withVideo: true }), /video itself is attached/);
});
