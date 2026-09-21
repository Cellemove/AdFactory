import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderTranscript, providerCopy, modeVersion } from "./brandsearch-research";
import { buildExtractPrompt, validateExtractedBeats } from "./cellumove/corpus/extract";
import { selectStageRows } from "./cellumove/corpus/queue";
import type { CorpusAdStateRow } from "./database.types";

test("provider transcript retains speech timestamps, confidence, hook and language", () => {
  const result = parseProviderTranscript({ transcript: { is_empty: false, duration: 12, language: "en", hook: "Opening", segments: [{ start: 2, end: 5, text: "These are the exact words", confidence: 0.8 }] } });
  assert.equal(result.status, "available"); assert.equal(result.segments[0]!.start, 2); assert.equal(result.segments[0]!.confidence, 0.8);
  assert.deepEqual(providerCopy({ creative: { description: "body", title: "headline", cta: { text: "Shop" } } }), { body: "body", headline: "headline", cta: "Shop" });
});
test("empty speech is distinct from missing; malformed timecodes fail closed", () => {
  assert.equal(parseProviderTranscript({ transcript: { is_empty: true, segments: [] } }).status, "empty");
  for (const segment of [{ start: 4, end: 2 }, { start: -1, end: 2 }, { start: 1, end: 90 }]) {
    assert.throws(() => parseProviderTranscript({ transcript: { is_empty: false, duration: 10, segments: [{ ...segment, text: "words" }] } }));
  }
  assert.throws(() => parseProviderTranscript({ transcript: { is_empty: false, segments: [] } }));
});
test("speech-only extraction rejects ost evidence and suppresses production format", () => {
  const allowedCodes = new Map([["H1", "H" as const]]);
  const segments = [{ id: "segment", channel: "vo" as const, orderIndex: 0, tStart: 2, tEnd: 5, text: "These are the exact words", confidence: 1 }];
  const raw = { format: "UGC", concept: "How it works", beats: [{ order_index: 0, layer: "H", code: "H1", t_start: 2, t_end: 5, evidence_quote: "These are the exact words", channel: "vo", other_explanation: null }] };
  assert.equal(validateExtractedBeats({ raw, allowedCodes, segments, transcriptEnd: 12, speechOnly: true }).format, null);
  assert.throws(() => validateExtractedBeats({ raw: { ...raw, beats: [{ ...raw.beats[0], channel: "ost" }] }, allowedCodes, segments, transcriptEnd: 12, speechOnly: true }), /only quote vo/);
  assert.throws(() => validateExtractedBeats({ raw: { ...raw, beats: [{ ...raw.beats[0], evidence_quote: "A completely invented medical guarantee" }] }, allowedCodes, segments, transcriptEnd: 12, speechOnly: true }), /not a near-exact/);
  assert.match(buildExtractPrompt({ taxonomyVersion: "test", taxonomy: [], transcriptText: "", durationSec: 12, language: null, speechOnly: true }), /allow silent gaps/);
});
test("speech queue ignores expired video while preserving corpus inclusion and empty speech", () => {
  const row = { id: "ad", brandName: "brand", corpusIncluded: true, mediaType: "video", mediaStatus: "expired", transcriptStatus: null } as CorpusAdStateRow;
  assert.equal(selectStageRows("transcribe", [row], { mode: "speech_only" }).length, 1);
  assert.equal(selectStageRows("transcribe", [row], { mode: "full_video" }).length, 0);
  assert.equal(selectStageRows("transcribe", [{ ...row, corpusIncluded: false }], { mode: "speech_only" }).length, 0);
  assert.equal(selectStageRows("extract", [{ ...row, transcriptStatus: "complete", segmentCount: 0 }], { mode: "speech_only" }).length, 0);
  assert.notEqual(modeVersion("engine", "speech_only"), modeVersion("engine", "full_video"));
});
