// Turn a reference ad video into a reusable ReferenceFormat beat skeleton.
//
// This module is pure — no Supabase, no `server-only`, no network — so the
// parts that are easy to get subtly wrong (label→kind mapping, time strings)
// can be unit-tested without touching the cloud. The server action in
// src/app/actions/reference-formats.ts owns the I/O.
//
// The whole design is dictated by two brittle downstream parsers:
//
//   kindFromLabel()   maps a beat LABEL to a module kind by regex, and is
//                     order-sensitive (/test/ in the hook branch swallows
//                     "Testimonial"; /regret/ swallows "The Regret Problem").
//   secondsFromBeat() reads the digits out of a time string like "0–3s". Feed
//                     it "0:00–0:03" and it silently returns 1 second.
//
// So the model is never asked for a formatted time string or a label it has to
// get exactly right: it returns an explicit `kind` plus integer seconds, and we
// synthesise the `time` string and repair the label here.

import { z } from "zod";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import { ScriptModuleKindSchema, kindFromLabel } from "@/lib/cellumove/script-studio";

type ScriptModuleKind = z.infer<typeof ScriptModuleKindSchema>;

// ─── Limits ──────────────────────────────────────────────────────────────────
// Both paths base64 the bytes into one inline Vertex request, so 15MB is the
// hard ceiling either way (matching ANALYZE_MAX_BYTES in actions/broll.ts):
// base64 inflates by 4/3, putting 15MB right at Vertex's 20MB request cap.
// next.config.ts must keep serverActions.bodySizeLimit above the upload cap so
// an oversized file gets this message instead of an opaque body error.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const REMOTE_MAX_BYTES = 15 * 1024 * 1024;

export const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mpeg",
  "video/3gpp",
]);

export const MIN_BEATS = 3;
export const MAX_BEATS = 10;
const MIN_BEAT_SECONDS = 2;

// ─── Media identification ────────────────────────────────────────────────────
// A framework can only be read from the moving ad. The remote-URL path resolves
// whatever a page advertises as its video, and pages get that wrong — og:video
// sometimes points at the poster frame, and a CDN can answer with an HTML error
// page under a video content-type. Sending a still image to Gemini would still
// produce a plausible-looking framework, from one frame, with nobody the wiser.
// So the bytes are checked against real container signatures before any call.

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export type MediaKind =
  | { kind: "video"; mime: string }
  | { kind: "image"; mime: string }
  /** HTML, XML, JSON or plain text — a login wall or error page, never a video. */
  | { kind: "text" }
  | { kind: "other" };

// Every video container starts with non-printable bytes (MP4 with 0x00, WebM
// with 0x1A). A run of pure printable ASCII means we were handed a document.
function looksTextual(bytes: Uint8Array): boolean {
  const window = Math.min(bytes.length, 64);
  for (let i = 0; i < window; i++) {
    const byte = bytes[i]!;
    const printable = byte >= 0x20 && byte <= 0x7e;
    const whitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (!printable && !whitespace) return false;
  }
  return window > 0;
}

/** Identify a media container from its magic bytes. */
export function sniffMediaKind(bytes: Uint8Array): MediaKind {
  if (bytes.length < 12) return { kind: "other" };

  // ISO base media (MP4 / MOV / M4V / 3GP): "ftyp" at offset 4, brand at 8.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (brand.startsWith("qt")) return { kind: "video", mime: "video/quicktime" };
    if (brand.startsWith("3g")) return { kind: "video", mime: "video/3gpp" };
    if (brand === "m4v ") return { kind: "video", mime: "video/x-m4v" };
    return { kind: "video", mime: "video/mp4" };
  }
  // Matroska / WebM share the EBML header; the doc type follows shortly after.
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: "video", mime: ascii(bytes, 0, 64).includes("webm") ? "video/webm" : "video/mp4" };
  }
  // MPEG program stream / transport stream.
  if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xba]) || bytes[0] === 0x47) {
    return { kind: "video", mime: "video/mpeg" };
  }

  // Images, named explicitly so the poster-frame case gets a precise message.
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" };
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
  if (ascii(bytes, 0, 4) === "GIF8") return { kind: "image", mime: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return { kind: "image", mime: "image/webp" };

  if (looksTextual(bytes)) return { kind: "text" };
  return { kind: "other" };
}

export type VideoMimeResult = { ok: true; mime: string } | { ok: false; reason: string };

/**
 * Decide what MIME to declare for downloaded bytes, refusing anything that
 * isn't actually video. Sniffed signatures beat the server's content-type —
 * a server claiming `video/mp4` while sending a JPEG is precisely the trap.
 */
export function resolveVideoMime(contentType: string, bytes: Uint8Array): VideoMimeResult {
  const declared = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const sniffed = sniffMediaKind(bytes);

  if (sniffed.kind === "video") return { ok: true, mime: sniffed.mime };
  if (sniffed.kind === "image") {
    return {
      ok: false,
      reason: `That link served an image (${sniffed.mime}), not a video — most likely the ad's poster frame. A framework can only be read from the moving ad.`,
    };
  }
  if (sniffed.kind === "text") {
    // A login wall, consent interstitial or error page, often served under the
    // content-type the caller asked for. Never trust the header over the bytes.
    return {
      ok: false,
      reason: "That link served a web page, not a video file — it may need a login, or the media may be behind a player.",
    };
  }
  // Unrecognised bytes: trust an explicit video content-type, since there are
  // more containers than are worth sniffing, but reject anything else.
  if (declared.startsWith("video/")) return { ok: true, mime: declared };
  if (declared.startsWith("image/")) {
    return {
      ok: false,
      reason: `That link served an image (${declared}), not a video — most likely the ad's poster frame. A framework can only be read from the moving ad.`,
    };
  }
  return {
    ok: false,
    reason: `That link served ${declared || "an unrecognised file type"} rather than a video file.`,
  };
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

/** Normalise youtu.be / shorts / embed forms, dropping playlist and time params. */
export function canonicalYouTubeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else {
        const match = url.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?#]+)/);
        id = match?.[1] ?? null;
      }
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}

// ─── Model contract ──────────────────────────────────────────────────────────

export const LlmFrameworkBeatSchema = z.object({
  label: z.string().trim().min(2).max(60),
  kind: ScriptModuleKindSchema,
  startSec: z.number().int().min(0).max(3600),
  endSec: z.number().int().min(1).max(3600),
  note: z.string().trim().min(5).max(400),
});

export const LlmFrameworkSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400),
  bestForAngle: z.string().trim().max(300).optional().default(""),
  videoDurationSec: z.number().finite().min(1).max(3600),
  confidence: z.enum(["high", "low"]).optional().default("high"),
  beats: z.array(LlmFrameworkBeatSchema).min(MIN_BEATS).max(MAX_BEATS),
});

export type LlmFramework = z.infer<typeof LlmFrameworkSchema>;
export type LlmFrameworkBeat = z.infer<typeof LlmFrameworkBeatSchema>;

// ─── Prompt ──────────────────────────────────────────────────────────────────

export function buildFrameworkExtractionPrompt(): string {
  return [
    "You are a creative strategist reverse-engineering the STRUCTURE of an ad so it",
    "can be reused for completely different products.",
    "",
    "Watch the whole video, then describe its reusable beat skeleton.",
    "",
    "THE ONE RULE THAT MATTERS",
    "Describe what each beat ACCOMPLISHES, never what this specific ad says.",
    '  BAD  "She says her knees stopped hurting after two weeks."',
    '  GOOD "Deliver a first-person result with a concrete timeframe, spoken to',
    '        camera without cuts so it reads as unrehearsed."',
    "Never name this video's product, brand, presenter, or claims — not in the name,",
    "the description, or any note. If a note only makes sense for this one product,",
    "rewrite it. Someone must be able to apply this framework to a mattress, a",
    "supplement, or a SaaS tool.",
    "",
    "BEATS",
    "- Return 4 to 8 beats. One beat per distinct structural move — a change of",
    "  intent, not every camera cut. Merge cuts that serve the same purpose.",
    "- Beats must tile the video: the first starts at 0, each starts where the",
    "  previous ended, the last ends at the video's true final second.",
    "- startSec / endSec are WHOLE SECONDS from the start. Integers only.",
    '  Never "0:03", never "3s", never a range in one field.',
    `- Every beat needs at least ${MIN_BEAT_SECONDS} seconds.`,
    "",
    'label   2-4 words, Title Case, naming the beat\'s JOB ("Visual Anomaly",',
    '        "Cost of Waiting", "Objection Flip"). Not the ad\'s words, not a',
    "        scene description.",
    "kind    exactly one of: hook | problem | agitation | solution | proof |",
    "        offer | cta | custom",
    "note    1-2 sentences: what this beat must accomplish and how it is staged",
    "        (who is on screen, what the camera does, on-screen text, audio).",
    "        A director's instruction for a DIFFERENT product.",
    "",
    "TOP LEVEL",
    'name             2-4 words naming the STRUCTURE, in the style of "Magic',
    '                 Formula", "Regret Arc", "Problem-Agitate-Solve". Not the',
    "                 brand, not the product.",
    "description      one sentence, the whole arc, reusable.",
    "bestForAngle     one sentence — which audience or angle this structure",
    "                 serves best, and when NOT to use it.",
    "videoDurationSec the video's actual total length, whole seconds.",
    'confidence       "high" if you could see and hear the whole ad; "low" if it',
    "                 was truncated, silent, or too ambiguous to read.",
    "",
    "Return ONLY this JSON object:",
    '{ "name": "...", "description": "...", "bestForAngle": "...",',
    '  "videoDurationSec": 0, "confidence": "high",',
    '  "beats": [ { "label": "...", "kind": "hook", "startSec": 0, "endSec": 0,',
    '               "note": "..." } ] }',
  ].join("\n");
}

// ─── Normalisation ───────────────────────────────────────────────────────────

// A label guaranteed to map to each kind, used when the model's own wording
// doesn't survive kindFromLabel's regexes.
const CANONICAL_LABEL: Record<ScriptModuleKind, string> = {
  hook: "Hook",
  problem: "Problem",
  agitation: "Agitation",
  solution: "Solution",
  proof: "Proof",
  offer: "Offer",
  cta: "CTA",
  custom: "Beat",
};

/**
 * Return a label that kindFromLabel actually resolves to `kind`.
 *
 * Correct by construction: it asks the real parser rather than duplicating its
 * regexes, so it stays right even if those regexes are later edited. Tries the
 * model's own wording first, then appends the canonical word ("Visual Anomaly"
 * → "Visual Anomaly Hook"), then falls back to the canonical word alone.
 */
export function enforceKind(label: string, kind: ScriptModuleKind): string {
  // `custom` is kindFromLabel's own fallback, so any label that fails to match
  // something else already lands there — but a label that matches a REAL kind
  // would be misfiled, so those still need the neutral canonical label.
  if (kind === "custom") return kindFromLabel(label) === "custom" ? label : CANONICAL_LABEL.custom;
  if (kindFromLabel(label) === kind) return label;
  const suffixed = `${label} ${CANONICAL_LABEL[kind]}`;
  if (kindFromLabel(suffixed) === kind) return suffixed;
  return CANONICAL_LABEL[kind];
}

/**
 * Turn the model's beats into ReferenceFormatBeat rows.
 *
 * The `time` string is generated here from integers, never echoed from the
 * model, so secondsFromBeat can't be handed a clock time or a bare number. Beat
 * boundaries are forced monotonic and at least MIN_BEAT_SECONDS long, so an
 * out-of-order or overlapping read still yields a sane skeleton.
 */
export function normalizeExtractedBeats(raw: LlmFrameworkBeat[]): ReferenceFormatBeat[] {
  let cursor = 0;
  return raw.map((beat) => {
    const start = Number.isInteger(beat.startSec) ? Math.max(cursor, beat.startSec) : cursor;
    const proposedEnd = Number.isInteger(beat.endSec) ? beat.endSec : start + 5;
    const end = Math.max(start + MIN_BEAT_SECONDS, proposedEnd);
    cursor = end;
    return {
      // EN DASH, matching the seeds in reference-formats.ts.
      label: enforceKind(beat.label.trim().slice(0, 60), beat.kind),
      time: `${start}–${end}s`,
      note: beat.note.trim().slice(0, 400),
    };
  });
}

/** Clamp to the range ScriptDocumentSchema accepts for targetDurationSec. */
export function frameworkDurationSec(parsed: LlmFramework, beats: ReferenceFormatBeat[]): number {
  const fromModel = Math.round(parsed.videoDurationSec);
  if (Number.isFinite(fromModel) && fromModel >= 5 && fromModel <= 600) return fromModel;
  // Fall back to where the last beat ends — always present and already clamped
  // to sane boundaries by normalizeExtractedBeats.
  const lastEnd = beats.length
    ? Number(beats[beats.length - 1]!.time.match(/\d+/g)?.slice(-1)[0] ?? 30)
    : 30;
  return Math.min(600, Math.max(5, lastEnd));
}

/**
 * Cheap product-leak detector. The "describe the structure, not this ad" rule is
 * prompt-enforced and unverifiable in general, but a brand name repeated across
 * notes is the common, obvious failure — worth surfacing so the user re-reads
 * the beats before trusting the framework.
 */
export function detectProductLeak(beats: ReferenceFormatBeat[]): string | null {
  const counts = new Map<string, number>();
  for (const beat of beats) {
    // Mid-sentence capitalised words only: a sentence-initial capital says
    // nothing, and we don't want every "Show"/"Open" flagged.
    const nouns = new Set(beat.note.match(/(?<=[a-z,] )[A-Z][a-zA-Z]{2,}/g) ?? []);
    for (const noun of nouns) counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  for (const [noun, count] of counts) {
    if (count >= 2) return noun;
  }
  return null;
}
