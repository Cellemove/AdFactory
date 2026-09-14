import assert from "node:assert/strict";
import test from "node:test";
import { bestSegmentMatch, gateBeats, levenshtein, normalizeForMatch, partialRatio, ratio, type GateSegment } from "./evidence-gate";

const segments: GateSegment[] = [
  { id: "vo0", channel: "vo", orderIndex: 0, tStart: 0, tEnd: 2.4, text: "Stop scrolling if your legs feel heavy by 3pm." },
  { id: "vo1", channel: "vo", orderIndex: 1, tStart: 2.4, tEnd: 6.0, text: "I used to think it was just being on my feet all day." },
  { id: "vo2", channel: "vo", orderIndex: 2, tStart: 6.0, tEnd: 9.5, text: "Turns out my circulation was the problem." },
  { id: "ost0", channel: "ost", orderIndex: 0, tStart: 0.4, tEnd: 2.0, text: "HEAVY LEGS?" },
  { id: "ost1", channel: "ost", orderIndex: 1, tStart: 7.0, tEnd: 9.5, text: "30-day money back", confidence: 0.4 },
];

test("normalisation ignores case, punctuation, curly quotes and spacing", () => {
  assert.equal(normalizeForMatch("It’s  “HEAVY”, legs!"), normalizeForMatch("it's \"heavy\" legs"));
});

test("levenshtein and ratio behave", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(ratio("abc", "abc"), 100);
  assert.equal(ratio("", ""), 100);
});

test("exact substring scores 100, a typo still passes, a paraphrase fails", () => {
  const hay = "I used to think it was just being on my feet all day.";
  assert.equal(partialRatio("just being on my feet", hay), 100);
  assert.ok(partialRatio("just being on my feat all day", hay) >= 90);
  assert.ok(partialRatio("standing all day was the cause", hay) < 90);
});

test("a quote spanning two adjacent segments matches and returns the first id", () => {
  const match = bestSegmentMatch("feet all day. Turns out my circulation", segments, "vo");
  assert.equal(match.score, 100);
  assert.equal(match.segmentId, "vo1");
  assert.deepEqual(match.span, [2.4, 9.5]);
});

test("gate passes a faithful decomposition and ignores layer order", () => {
  const report = gateBeats([
    { orderIndex: 0, evidenceQuote: "Stop scrolling if your legs feel heavy", channel: "vo", tStart: 0, tEnd: 2.4 },
    { orderIndex: 1, evidenceQuote: "HEAVY LEGS?", channel: "ost", tStart: 0.4, tEnd: 2.0 },
    { orderIndex: 2, evidenceQuote: "my circulation was the problem", channel: "vo", tStart: 6.0, tEnd: 9.5 },
  ], segments, { transcriptEnd: 9.5 });
  assert.equal(report.ok, true, report.errors.join(" | "));
  assert.equal(report.perBeat[0]?.matchedSegmentId, "vo0");
  assert.equal(report.perBeat[1]?.matchedSegmentId, "ost0");
});

test("gate rejects invented quotes with the retry sentence", () => {
  const report = gateBeats([{ orderIndex: 0, evidenceQuote: "clinically proven to double circulation", channel: "vo", tStart: 0, tEnd: 2 }], segments, { transcriptEnd: 9.5 });
  assert.equal(report.ok, false);
  assert.match(report.errors[0] ?? "", /not a near-exact transcript substring/);
  assert.equal(report.perBeat[0]?.matchedSegmentId, null);
});

test("gate reports a channel mismatch when the quote lives in the other channel", () => {
  const report = gateBeats([{ orderIndex: 0, evidenceQuote: "HEAVY LEGS?", channel: "vo", tStart: 0.4, tEnd: 2.0 }], segments, { transcriptEnd: 9.5 });
  assert.equal(report.ok, false);
  assert.match(report.errors[0] ?? "", /declares channel "vo"/);
  assert.equal(report.perBeat[0]?.matchedChannel, "ost");
});

test("gate enforces timecodes: beyond the end, outside the segment, out of order", () => {
  const beyond = gateBeats([{ orderIndex: 0, evidenceQuote: "my circulation was the problem", channel: "vo", tStart: 6, tEnd: 14 }], segments, { transcriptEnd: 9.5 });
  assert.match(beyond.errors.join(" "), /transcript ends at 9.5s/);
  const outside = gateBeats([{ orderIndex: 0, evidenceQuote: "my circulation was the problem", channel: "vo", tStart: 0, tEnd: 1 }], segments, { transcriptEnd: 9.5 });
  assert.match(outside.errors.join(" "), /do not overlap the quoted segment/);
  const disorder = gateBeats([
    { orderIndex: 0, evidenceQuote: "my circulation was the problem", channel: "vo", tStart: 6, tEnd: 9.5 },
    { orderIndex: 1, evidenceQuote: "Stop scrolling", channel: "vo", tStart: 0, tEnd: 2 },
  ], segments, { transcriptEnd: 9.5 });
  assert.match(disorder.errors.join(" "), /not in time order/);
});

test("low-confidence on-screen evidence is flagged but still passes", () => {
  const report = gateBeats([{ orderIndex: 0, evidenceQuote: "30-day money back", channel: "ost", tStart: 7, tEnd: 9.5 }], segments, { transcriptEnd: 9.5 });
  assert.equal(report.ok, true);
  assert.equal(report.perBeat[0]?.lowConfidenceEvidence, true);
});
