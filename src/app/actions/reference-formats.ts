"use server";

// "Copy the framework from this video." Gemini watches a reference ad and
// returns its reusable beat skeleton, which is saved as a real ReferenceFormat
// row — so it appears in the framework picker from then on and works in batch
// generation like any seeded format.
//
// Vertex AI has NO Files API ("does not support uploading files. You can share
// files through a GCS bucket"), and there is no GCS bucket here. So there are
// exactly two ways to hand it a video: inline base64 bytes, or a YouTube URL as
// a fileData part. Every non-YouTube path must therefore download the bytes.
//
// The hard rule of this module: the model is NEVER called unless real video
// bytes (or a live YouTube URI) were obtained. There is no HTML-only,
// caption-only or thumbnail-only fallback — a framework that wasn't extracted
// from a watched video is worse than no framework, because it gets saved and
// reused silently.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStrategist } from "@/lib/authorization";
import { supabase } from "@/lib/db";
import { getLLM, DEFAULT_MODEL, isLLMConfigured } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { fetchThroughProxy, fetchBinaryThroughProxy, extractVideoUrl, isPubliclyRoutable } from "@/lib/scraper";
import { extractJsonObject } from "@/lib/cellumove/agents";
import { upsertReferenceFormat } from "@/app/actions/sops";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import {
  ALLOWED_VIDEO_MIMES,
  LlmFrameworkSchema,
  MAX_UPLOAD_BYTES,
  REMOTE_MAX_BYTES,
  buildFrameworkExtractionPrompt,
  canonicalYouTubeUrl,
  detectProductLeak,
  frameworkDurationSec,
  normalizeExtractedBeats,
  resolveVideoMime,
  type LlmFramework,
} from "@/lib/cellumove/framework-extraction";

const ExtractFrameworkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("upload"), nameOverride: z.string().trim().max(80).optional() }),
  z.object({ mode: z.literal("youtube"), url: z.string().url().max(2000), nameOverride: z.string().trim().max(80).optional() }),
  z.object({ mode: z.literal("url"), url: z.string().url().max(2000), nameOverride: z.string().trim().max(80).optional() }),
]);

export interface ExtractedFramework {
  id: string;
  name: string;
  /** Matches the `frameworks` prop shape ScriptProjectForm already consumes. */
  duration: number | null;
  beats: ReferenceFormatBeat[];
  sourceLabel: string;
  /** Set when a brand name looked like it leaked into the reusable notes. */
  leakWarning: string | null;
}

// A Gemini part carrying the video, plus how to describe where it came from.
interface VideoInput {
  part: Record<string, unknown>;
  sourceLabel: string;
  sourceUrl: string | null;
}

const UPLOAD_FALLBACK =
  "Download the video and use the Upload tab — that path is reliable and gives a better read anyway.";

// ─── YouTube ─────────────────────────────────────────────────────────────────

/**
 * Confirm the video exists and is public before spending a Pro call on it. The
 * oEmbed endpoint returns JSON only for real, viewable videos — the same trick
 * the Spy sweep uses to verify links. Its title is also the best fallback name.
 */
async function youtubeTitle(url: string): Promise<{ ok: boolean; title: string }> {
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetchThroughProxy(oembed, { accept: "application/json", timeoutMs: 8000 });
  if (!res?.ok || !res.body) return { ok: false, title: "" };
  try {
    const parsed = JSON.parse(res.body) as { title?: string };
    return { ok: true, title: parsed.title?.trim() ?? "" };
  } catch {
    return { ok: false, title: "" };
  }
}

// ─── Arbitrary ad URL ────────────────────────────────────────────────────────

const DIRECT_MEDIA = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

/**
 * Best effort, four ordered strategies. Realistically this succeeds on direct
 * media links and pages that publish og:video; TikTok, Instagram and Facebook
 * render their players client-side and usually expose nothing to a plain fetch.
 * That is a known and accepted limitation — the point is to fail fast and say
 * exactly what to do instead.
 */
async function resolveRemoteVideo(rawUrl: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const host = safeHost(rawUrl);
  const fail = (why: string): never => {
    throw new Error(`Could not pull a video file from ${host}. ${why} ${UPLOAD_FALLBACK}`);
  };
  if (!isPubliclyRoutable(rawUrl)) {
    throw new Error("That URL isn't a public http(s) address, so it can't be fetched.");
  }

  // Nothing reaches Gemini until its bytes are confirmed to be a real video
  // container — a page's advertised "video" is regularly its poster frame.
  const accept = (media: { bytes: Buffer; contentType: string }): { bytes: Buffer; mimeType: string } => {
    if (media.bytes.byteLength === 0) fail("The link returned an empty file.");
    const resolved = resolveVideoMime(media.contentType, media.bytes);
    if (!resolved.ok) fail(resolved.reason);
    return { bytes: media.bytes, mimeType: (resolved as { ok: true; mime: string }).mime };
  };

  // 1 + 2. A direct media link, or any URL that turns out to serve video bytes.
  //        The content-type check covers extensionless CDN links.
  const direct = await fetchBinaryThroughProxy(rawUrl, { maxBytes: REMOTE_MAX_BYTES, timeoutMs: 45000 });
  if (direct && (direct.contentType.startsWith("video/") || DIRECT_MEDIA.test(rawUrl))) {
    return accept(direct);
  }
  if (DIRECT_MEDIA.test(rawUrl)) {
    fail(`The file didn't download — it may be private, expired, or larger than ${mb(REMOTE_MAX_BYTES)}MB.`);
  }

  // 3. Scrape the page for a video the markup exposes.
  const page = await fetchThroughProxy(rawUrl, { timeoutMs: 12000 });
  if (!page?.ok || !page.body) {
    fail("The page could not be loaded.");
  }
  const found = extractVideoUrl(page!.body, rawUrl);
  if (!found) {
    fail(
      "TikTok, Instagram, and Facebook Ads Library render their players with JavaScript and usually hide the media from a plain page fetch — this path only works on links that expose a direct video file.",
    );
  }
  const media = await fetchBinaryThroughProxy(found!, { maxBytes: REMOTE_MAX_BYTES, timeoutMs: 45000 });
  if (!media) {
    fail(`Found a video on the page but could not download it — it may be protected or larger than ${mb(REMOTE_MAX_BYTES)}MB.`);
  }
  return accept(media!);
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "that link";
  }
}

function mb(bytes: number): string {
  return String(Math.round(bytes / 1024 / 1024));
}

// ─── Input assembly ──────────────────────────────────────────────────────────

async function buildVideoInput(
  parsed: z.infer<typeof ExtractFrameworkSchema>,
  file: File | null,
): Promise<VideoInput> {
  if (parsed.mode === "upload") {
    if (!file) throw new Error("No video file was uploaded.");
    if (!ALLOWED_VIDEO_MIMES.has(file.type)) {
      throw new Error(
        file.type
          ? `Unsupported video type: ${file.type}. Use MP4, MOV, WEBM, M4V, MPEG, or 3GP.`
          : "Your browser did not report a file type — re-export the clip as MP4.",
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The upload path accepts up to ${mb(MAX_UPLOAD_BYTES)}MB — trim to the first ~60 seconds, or export at 720p / a lower bitrate. A framework only needs to see the structure, not the pixels.`,
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    return {
      part: { inlineData: { mimeType: file.type, data: bytes.toString("base64") } },
      sourceLabel: file.name || "uploaded clip",
      sourceUrl: null,
    };
  }

  if (parsed.mode === "youtube") {
    const canonical = canonicalYouTubeUrl(parsed.url);
    if (!canonical) {
      throw new Error("That doesn't look like a YouTube video link. Paste a youtube.com/watch, /shorts, or youtu.be URL.");
    }
    // Catch dead/private links here, before any Gemini spend.
    const { ok, title } = await youtubeTitle(canonical);
    if (!ok) {
      throw new Error(`YouTube did not return that video — it may be private, deleted, or the link may be wrong. ${UPLOAD_FALLBACK}`);
    }
    return {
      part: { fileData: { fileUri: canonical, mimeType: "video/*" } },
      sourceLabel: title ? `YouTube · ${title}` : "YouTube video",
      sourceUrl: canonical,
    };
  }

  // mimeType is the container actually sniffed from the bytes, not a guess —
  // declaring the wrong one makes Vertex reject the part or misread the video.
  const { bytes, mimeType } = await resolveRemoteVideo(parsed.url);
  return {
    part: { inlineData: { mimeType, data: bytes.toString("base64") } },
    sourceLabel: safeHost(parsed.url),
    sourceUrl: parsed.url,
  };
}

// Vertex rejects a YouTube fileUri with a 400 in regions where that feature
// isn't enabled. Name the actual knob rather than leaking a raw API error.
function describeModelError(cause: unknown, mode: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (mode === "youtube" && /INVALID_ARGUMENT|fileUri|not supported|PERMISSION_DENIED|400/i.test(message)) {
    return `Vertex AI would not read that YouTube link (it must be a public video, and YouTube-link reading is not enabled for every Google Cloud region). Try setting GOOGLE_CLOUD_LOCATION=us-central1, or download the video and use the Upload tab.`;
  }
  if (/deadline|timeout|aborted/i.test(message)) {
    return "Gemini timed out watching that video. Try a shorter clip (under ~2 minutes).";
  }
  return `Gemini could not read that video: ${message}`;
}

// Extracted formats sort below the seeded ones (1..11), newest last. The 100
// floor leaves room to add seeds 12..99 later without interleaving.
async function nextExtractedOrder(): Promise<number> {
  const top = await supabase
    .from("ReferenceFormat")
    .select("order")
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Math.max(100, (top.data?.order ?? 0) + 1);
}

// The provenance columns arrive with migration 014. Without them the insert
// fails on a raw Postgres error naming a column — say what to run instead.
async function saveFramework(input: Parameters<typeof upsertReferenceFormat>[0]) {
  try {
    return await upsertReferenceFormat(input);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/column .* does not exist|schema cache/i.test(message)) {
      throw new Error(
        "Reference-format provenance columns are missing — run migrations/014_reference_format_provenance.sql in Supabase. The framework was read from the video but not saved.",
      );
    }
    throw cause;
  }
}

// ─── The action ──────────────────────────────────────────────────────────────

export async function createFrameworkFromVideo(formData: FormData): Promise<ExtractedFramework> {
  await requireStrategist();
  if (!isLLMConfigured()) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set — Gemini can't watch the video.");
  }

  const parsed = ExtractFrameworkSchema.parse({
    mode: formData.get("mode"),
    ...(formData.get("url") ? { url: String(formData.get("url")).trim() } : {}),
    ...(formData.get("nameOverride") ? { nameOverride: String(formData.get("nameOverride")).trim() } : {}),
  });
  const upload = formData.get("video");
  const input = await buildVideoInput(parsed, upload instanceof File ? upload : null);

  const llm = getLLM();
  let response;
  try {
    response = await llm.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: "user", parts: [input.part, { text: buildFrameworkExtractionPrompt() }] }],
      config: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 4096 },
    });
  } catch (cause) {
    throw new Error(describeModelError(cause, parsed.mode));
  }
  await recordUsage({ feature: "framework_extraction", model: DEFAULT_MODEL, usage: response.usageMetadata });

  const text = response.text ?? "";
  if (!text.trim()) throw new Error("Gemini returned no output for that video.");
  const extracted: LlmFramework = LlmFrameworkSchema.parse(extractJsonObject(text));

  // Refuse rather than persist a framework the model couldn't actually read —
  // a bad reusable row is worse than none, because it gets picked again later.
  if (extracted.confidence === "low") {
    throw new Error(
      "Gemini couldn't read this ad's structure confidently — it may be silent, truncated, or too abstract. Nothing was saved.",
    );
  }

  const beats = normalizeExtractedBeats(extracted.beats);
  const optimalDurationSec = frameworkDurationSec(extracted, beats);
  const name = parsed.nameOverride?.trim() || extracted.name;
  const copiedOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const saved = await saveFramework({
    name,
    // `description` is shown in /knowledge but never fed to the generation
    // prompt, so provenance is safe to carry here as well as in the columns.
    description: `${extracted.description} · Copied from ${input.sourceLabel} on ${copiedOn}`.slice(0, 600),
    beats: JSON.stringify(beats),
    bestForAngle: extracted.bestForAngle || null,
    optimalDurationSec,
    order: await nextExtractedOrder(),
    sourceKind: parsed.mode,
    sourceUrl: input.sourceUrl,
    sourceLabel: input.sourceLabel,
  });

  revalidatePath("/scripts/new");
  return {
    id: saved.id,
    name: saved.name,
    duration: saved.optimalDurationSec,
    beats,
    sourceLabel: input.sourceLabel,
    leakWarning: detectProductLeak(beats),
  };
}
