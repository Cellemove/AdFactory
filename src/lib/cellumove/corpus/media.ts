// MEDIA — pure half. Which URL to download for an ad, whether the provider
// link is still alive, and how the local file is named.
//
// BrandSearch media links die three days after the fetch, so the download has
// to happen in the same session as ingestion. The SD rendition is preferred:
// the model only needs to read and hear the ad, and SD keeps most ads under
// the 15MB inline ceiling.

import type { Json } from "@/lib/database.types";

export type MediaSourceKind = "video_sd_url" | "video_hd_url" | "videoUrl";

export type MediaSource = { url: string; kind: MediaSourceKind };

export type AdLike = {
  mediaType: string;
  videoUrl: string | null;
  rawPayload: Json;
  mediaExpiresAt?: string | null;
};

function stringField(payload: Json, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The URL to download, SD first, or null for image ads / ads without any video link. */
export function pickMediaSource(ad: AdLike): MediaSource | null {
  if (ad.mediaType !== "video") return null;
  const sd = stringField(ad.rawPayload, "video_sd_url");
  if (sd) return { url: sd, kind: "video_sd_url" };
  const hd = stringField(ad.rawPayload, "video_hd_url");
  if (hd) return { url: hd, kind: "video_hd_url" };
  if (ad.videoUrl?.trim()) return { url: ad.videoUrl.trim(), kind: "videoUrl" };
  return null;
}

export function isMediaLinkExpired(ad: Pick<AdLike, "mediaExpiresAt">, now: number = Date.now()): boolean {
  if (!ad.mediaExpiresAt) return false;
  const expires = Date.parse(ad.mediaExpiresAt);
  return Number.isFinite(expires) && expires <= now;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/mpeg": "mpg",
  "video/3gpp": "3gp",
};

export function mediaFileName(sha256: string, mime: string): string {
  return `${sha256}.${EXTENSION_BY_MIME[mime.toLowerCase()] ?? "bin"}`;
}

/** Human-readable megabytes for status reasons. */
export function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
