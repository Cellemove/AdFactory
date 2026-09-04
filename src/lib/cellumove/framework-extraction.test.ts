import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  LlmFrameworkSchema,
  buildFrameworkExtractionPrompt,
  canonicalYouTubeUrl,
  detectProductLeak,
  enforceKind,
  frameworkDurationSec,
  normalizeExtractedBeats,
  resolveVideoMime,
  sniffMediaKind,
  type LlmFrameworkBeat,
} from "./framework-extraction";
import { kindFromLabel, secondsFromBeat } from "./script-studio";

const beat = (over: Partial<LlmFrameworkBeat> = {}): LlmFrameworkBeat => ({
  label: "Visual Anomaly",
  kind: "hook",
  startSec: 0,
  endSec: 3,
  note: "Open mid-action on something visually odd so the viewer stays to resolve it.",
  ...over,
});

// The same schema create-script-project.server.ts uses to gate a stored format.
const BeatsSchema = z.array(z.object({ label: z.string(), time: z.string(), note: z.string() }));

test("every normalized label round-trips through the real kindFromLabel", () => {
  const kinds = ["hook", "problem", "agitation", "solution", "proof", "offer", "cta"] as const;
  for (const kind of kinds) {
    // Deliberately unhelpful labels: none of these contain the kind's keywords.
    const [normalized] = normalizeExtractedBeats([beat({ label: "Quiet Moment", kind })]);
    assert.equal(kindFromLabel(normalized!.label), kind, `label "${normalized!.label}" for kind ${kind}`);
  }
});

test("a custom beat never gets misfiled as a real kind", () => {
  // "Regret" would otherwise be swallowed by kindFromLabel's hook branch.
  const [normalized] = normalizeExtractedBeats([beat({ label: "Regret Montage", kind: "custom" })]);
  assert.equal(kindFromLabel(normalized!.label), "custom");
});

test("kindFromLabel's regex traps do not misclassify extracted beats", () => {
  // /regret/ sits in the hook branch, ahead of problem.
  assert.equal(kindFromLabel(enforceKind("The Regret", "problem")), "problem");
  // /test/ sits in the hook branch and swallows "Testimonial".
  assert.equal(kindFromLabel(enforceKind("Testimonial Wall", "proof")), "proof");
  // /myth/ is a hook keyword; as a solution beat it must not stay a hook.
  assert.equal(kindFromLabel(enforceKind("Myth Correction", "solution")), "solution");
});

test("a label the model already got right is preserved verbatim", () => {
  assert.equal(enforceKind("Cost of Waiting Agitation", "agitation"), "Cost of Waiting Agitation");
  const [normalized] = normalizeExtractedBeats([beat({ label: "Dream Outcome", kind: "hook" })]);
  assert.equal(normalized!.label, "Dream Outcome");
});

test("secondsFromBeat reads back the duration the model reported", () => {
  const beats = normalizeExtractedBeats([
    beat({ startSec: 0, endSec: 3 }),
    beat({ label: "Name the Frustration", kind: "problem", startSec: 3, endSec: 9 }),
    beat({ label: "Escalating Demo", kind: "solution", startSec: 9, endSec: 22 }),
    beat({ label: "Single-Line Close", kind: "cta", startSec: 22, endSec: 34 }),
  ]);
  assert.deepEqual(beats.map((b) => secondsFromBeat(b, 99)), [3, 6, 13, 12]);
});

test("time strings use the en-dash form the seeds use, never clock time", () => {
  const [normalized] = normalizeExtractedBeats([beat({ startSec: 12, endSec: 19 })]);
  assert.equal(normalized!.time, "12–19s");
  assert.doesNotMatch(normalized!.time, /:/);
});

test("overlapping, out-of-order and too-short beats are forced monotonic", () => {
  const beats = normalizeExtractedBeats([
    beat({ startSec: 0, endSec: 5 }),
    beat({ label: "Backwards", kind: "problem", startSec: 2, endSec: 4 }), // starts before the last one ended
    beat({ label: "Zero Length", kind: "proof", startSec: 9, endSec: 9 }), // no duration at all
  ]);
  const bounds = beats.map((b) => (b.time.match(/\d+/g) ?? []).map(Number));
  assert.deepEqual(bounds, [[0, 5], [5, 7], [9, 11]]);
  for (const b of beats) assert.ok(secondsFromBeat(b, 0) >= 2, `beat "${b.label}" is at least 2s`);
});

test("normalized beats satisfy the schema create-script-project validates against", () => {
  const beats = normalizeExtractedBeats([beat(), beat({ label: "Close", kind: "cta", startSec: 3, endSec: 30 })]);
  assert.doesNotThrow(() => BeatsSchema.parse(beats));
});

test("duration falls back to the last beat when the model reports nonsense", () => {
  const beats = normalizeExtractedBeats([beat({ startSec: 0, endSec: 44 })]);
  const parsed = LlmFrameworkSchema.parse({
    name: "Silent Demo Escalation",
    description: "Opens on a wordless anomaly, escalates a demo, closes on one line.",
    videoDurationSec: 3599, // beyond the 600s ScriptDocument ceiling
    beats: [beat(), beat({ kind: "problem", startSec: 3, endSec: 9 }), beat({ kind: "cta", startSec: 9, endSec: 20 })],
  });
  assert.equal(frameworkDurationSec(parsed, beats), 44);
});

test("the schema rejects a beat count that is not a usable framework", () => {
  const base = { name: "Too Thin", description: "", videoDurationSec: 30 };
  assert.throws(() => LlmFrameworkSchema.parse({ ...base, beats: [beat(), beat()] }));
  assert.throws(() => LlmFrameworkSchema.parse({ ...base, beats: Array.from({ length: 11 }, () => beat()) }));
});

// ─── The whole video reaches the model, and nothing else does ────────────────
// A still image would still yield a plausible-looking framework read from one
// frame, with nobody the wiser, so the byte-level check is the real guarantee.

const bytesOf = (...parts: Array<number[] | string>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part)));

const MP4 = bytesOf([0, 0, 0, 0x20], "ftyp", "isom", [0, 0, 2, 0]);
const MOV = bytesOf([0, 0, 0, 0x14], "ftyp", "qt  ", [0, 0, 2, 0]);
const WEBM = bytesOf([0x1a, 0x45, 0xdf, 0xa3], [0x01, 0, 0, 0, 0, 0, 0, 0x23, 0x42, 0x86, 0x81, 0x01], "webm", [0, 0, 0, 0]);
const PNG = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]);
const JPEG = bytesOf([0xff, 0xd8, 0xff, 0xe0], [0, 0x10], "JFIF", [0, 0, 0]);
const HTML = bytesOf("<!DOCTYPE html><html><head><title>Login</title>");

test("real video containers are identified from their magic bytes", () => {
  assert.deepEqual(sniffMediaKind(MP4), { kind: "video", mime: "video/mp4" });
  assert.deepEqual(sniffMediaKind(MOV), { kind: "video", mime: "video/quicktime" });
  assert.deepEqual(sniffMediaKind(WEBM), { kind: "video", mime: "video/webm" });
});

test("a poster frame is refused even when the server calls it a video", () => {
  // The exact trap: og:video pointing at the thumbnail, served as video/mp4.
  for (const image of [PNG, JPEG]) {
    const result = resolveVideoMime("video/mp4", image);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /image .*not a video|poster frame/i);
  }
});

test("an HTML error page is never sent as video", () => {
  const result = resolveVideoMime("video/mp4", HTML);
  assert.equal(result.ok, false);
});

test("the declared MIME is corrected to the container actually downloaded", () => {
  // A WebM served as video/mp4 must be declared webm, or Vertex misreads it.
  assert.deepEqual(resolveVideoMime("video/mp4", WEBM), { ok: true, mime: "video/webm" });
  // Content-type params are tolerated.
  assert.deepEqual(resolveVideoMime("video/mp4; charset=binary", MP4), { ok: true, mime: "video/mp4" });
});

test("an unsniffable container is accepted only on an explicit video content-type", () => {
  const odd = bytesOf([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc]);
  assert.deepEqual(resolveVideoMime("video/x-matroska", odd), { ok: true, mime: "video/x-matroska" });
  assert.equal(resolveVideoMime("application/octet-stream", odd).ok, false);
  assert.equal(resolveVideoMime("", odd).ok, false);
});

test("YouTube links are canonicalised to a watch URL the model can open", () => {
  const expected = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(canonicalYouTubeUrl("https://youtu.be/dQw4w9WgXcQ"), expected);
  assert.equal(canonicalYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), expected);
  assert.equal(canonicalYouTubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), expected);
  // Playlist and timestamp params are dropped so the model opens the video itself.
  assert.equal(canonicalYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=42s"), expected);
  assert.equal(canonicalYouTubeUrl("https://vimeo.com/12345"), null);
  assert.equal(canonicalYouTubeUrl("not a url"), null);
});

test("the prompt requires evidence the whole video was watched", () => {
  const prompt = buildFrameworkExtractionPrompt();
  // Beats must tile to the true final second — unreachable from one frame.
  assert.match(prompt, /tile the video/i);
  assert.match(prompt, /last ends at the video's true final second/i);
  assert.match(prompt, /videoDurationSec/);
  // And an unreadable video must be declared rather than guessed at.
  assert.match(prompt, /confidence/i);
  assert.match(prompt, /truncated, silent/i);
});

test("a brand name repeated across notes is flagged as a product leak", () => {
  const leaky = normalizeExtractedBeats([
    beat({ note: "Show the CelluMove leggings being pulled on in one take." }),
    beat({ label: "Proof", kind: "proof", startSec: 3, endSec: 9, note: "Cut to a wearer describing CelluMove after two weeks." }),
  ]);
  assert.equal(detectProductLeak(leaky), "CelluMove");

  const clean = normalizeExtractedBeats([
    beat({ note: "Open mid-action on a visually odd, incomplete gesture with no spoken setup." }),
    beat({ label: "Proof", kind: "proof", startSec: 3, endSec: 9, note: "Cut to a first-person result with a concrete timeframe." }),
  ]);
  assert.equal(detectProductLeak(clean), null);
});
