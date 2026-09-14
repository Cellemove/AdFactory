import assert from "node:assert/strict";
import test from "node:test";
import { crossCheckTranscript, normalizeTranscript, parseBrandSearchTranscript, renderTranscript } from "./transcribe";

test("normalisation sorts, clamps, dedupes repeated captions and derives the duration", () => {
  const transcript = normalizeTranscript({
    duration_sec: 20,
    language: "EN",
    segments: [
      { channel: "vo", t_start: 5, t_end: 8, text: "second line" },
      { channel: "vo", t_start: -1, t_end: 2, text: "  first   line " },
      { channel: "vo", t_start: 9, t_end: 9, text: "zero length" },
      { channel: "vo", t_start: 10, t_end: 11, text: "[inaudible]" },
      { channel: "ost", t_start: 1.0, t_end: 2.0, text: "SALE 50%" },
      { channel: "ost", t_start: 2.5, t_end: 3.5, text: "sale 50%", confidence: 0.9 },
      { channel: "ost", t_start: 22.0, t_end: 23.0, text: "SALE 50%" },
      { channel: "ost", t_start: 4, t_end: 5, text: "   " },
    ],
  });
  const vo = transcript.segments.filter((segment) => segment.channel === "vo");
  const ost = transcript.segments.filter((segment) => segment.channel === "ost");
  assert.deepEqual(vo.map((segment) => [segment.orderIndex, segment.tStart, segment.text]), [[0, 0, "first line"], [1, 5, "second line"], [2, 9, "zero length"]]);
  assert.equal(vo[2]?.tEnd, 9.1);
  assert.deepEqual(ost.map((segment) => [segment.orderIndex, segment.tStart, segment.tEnd]), [[0, 1, 3.5], [1, 22, 23]]);
  assert.equal(ost[0]?.confidence, 0.9);
  assert.equal(transcript.durationSec, 23);
  assert.equal(transcript.language, "en");
});

test("normalisation rejects a segment far beyond the video and an empty transcript", () => {
  assert.throws(() => normalizeTranscript({ duration_sec: 10, segments: [{ channel: "vo", t_start: 40, t_end: 41, text: "late" }, { channel: "vo", t_start: 0, t_end: 10, text: "x" }] }), /after the/);
  assert.throws(() => normalizeTranscript({ duration_sec: 10, segments: [] }), /no segments/);
});

test("renderTranscript emits one timecoded line per segment", () => {
  const text = renderTranscript([
    { channel: "ost", orderIndex: 0, tStart: 0.4, tEnd: 2, text: "HEAVY LEGS?", confidence: null },
    { channel: "vo", orderIndex: 0, tStart: 0, tEnd: 2.3, text: "Stop scrolling", confidence: null },
  ]);
  assert.equal(text, "[vo 0.0-2.3] Stop scrolling\n[ost 0.4-2.0] HEAVY LEGS?");
});

test("provider transcripts parse from VTT, JSON and plain text", () => {
  assert.equal(parseBrandSearchTranscript("WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello <b>there</b>\n\n2\n00:00:02.000 --> 00:00:04.000\nworld"), "Hello there world");
  assert.equal(parseBrandSearchTranscript(JSON.stringify({ segments: [{ text: "Hello" }, { text: "world" }] })), "Hello world");
  assert.equal(parseBrandSearchTranscript(JSON.stringify([{ text: "a" }, { text: "b" }])), "a b");
  assert.equal(parseBrandSearchTranscript("  plain   text\nline "), "plain text line");
});

test("cross-check verdicts follow token overlap", () => {
  const vo = [{ text: "Stop scrolling if your legs feel heavy" }];
  assert.equal(crossCheckTranscript(vo, "stop scrolling if your legs feel heavy by 3pm").verdict, "agree");
  assert.equal(crossCheckTranscript(vo, "legs heavy tired swollen ankles evening pain relief").verdict, "diverge");
  assert.equal(crossCheckTranscript(vo, null).verdict, "unavailable");
});
