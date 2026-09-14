import "server-only";

import { readFile } from "node:fs/promises";
import { resolveVideoMime } from "@/lib/cellumove/framework-extraction";
import type { AdMediaRow, CompetitorAdRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { fetchBinaryThroughProxy, isPubliclyRoutable } from "@/lib/scraper";
import { CORPUS_MEDIA_BUCKET, CORPUS_MEDIA_MAX_BYTES } from "./constants";
import { mediaId, sha256Hex } from "./ids";
import { formatMb, isMediaLinkExpired, mediaFileName, pickMediaSource } from "./media";

export type DownloadMediaOptions = {
  /** Re-download even when a stored copy exists. */
  force?: boolean;
};

export async function loadAdMedia(competitorAdId: string): Promise<AdMediaRow | null> {
  const result = await supabase.from("AdMedia").select("*").eq("competitorAdId", competitorAdId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as AdMediaRow | null) ?? null;
}

/** A stored copy is trusted here; readAdMedia re-verifies its hash on every read. */
async function hasStoredCopy(media: AdMediaRow): Promise<boolean> {
  if (media.storagePath) return true;
  // Pre-019 rows point at a file on the machine that downloaded them.
  if (!media.localPath || !media.sha256) return false;
  try {
    return sha256Hex(await readFile(media.localPath)) === media.sha256;
  } catch {
    return false;
  }
}

async function upsertMedia(row: Partial<AdMediaRow> & { competitorAdId: string; status: string }): Promise<AdMediaRow> {
  const now = new Date().toISOString();
  const write = await supabase.from("AdMedia").upsert(
    { id: mediaId(row.competitorAdId), updatedAt: now, ...row },
    { onConflict: "competitorAdId" },
  ).select("*").single();
  if (write.error) throw new Error(write.error.message);
  return write.data as AdMediaRow;
}

/** Content-Length probe so an oversize file is reported as such instead of as "unavailable". */
async function declaredSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "");
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

/**
 * Download an ad's video into the local media folder and record it in AdMedia.
 * Never throws for a per-ad problem — the outcome lands in `status` +
 * `statusReason` so the runner can keep going and the page can explain it.
 */
export async function downloadAdMedia(ad: CompetitorAdRow, options: DownloadMediaOptions = {}): Promise<AdMediaRow> {
  const existing = await loadAdMedia(ad.id);
  if (existing && existing.status === "downloaded" && !options.force && await hasStoredCopy(existing)) {
    return existing;
  }

  const source = pickMediaSource(ad);
  if (!source) {
    return upsertMedia({
      competitorAdId: ad.id,
      status: ad.mediaType === "video" ? "unavailable" : "not_video",
      statusReason: ad.mediaType === "video" ? "BrandSearch returned no video URL for this ad." : "Image ad — nothing to transcribe.",
    });
  }
  if (!isPubliclyRoutable(source.url)) {
    return upsertMedia({ competitorAdId: ad.id, status: "unavailable", statusReason: "Video URL is not a public http(s) address.", sourceUrl: source.url, sourceKind: source.kind });
  }

  const size = await declaredSize(source.url);
  if (size !== null && size > CORPUS_MEDIA_MAX_BYTES) {
    return upsertMedia({
      competitorAdId: ad.id,
      status: "oversize",
      statusReason: `Video is ${formatMb(size)}; the inline ceiling is ${formatMb(CORPUS_MEDIA_MAX_BYTES)}.`,
      sourceUrl: source.url,
      sourceKind: source.kind,
      bytes: size,
    });
  }

  const fetched = await fetchBinaryThroughProxy(source.url, { maxBytes: CORPUS_MEDIA_MAX_BYTES, timeoutMs: 60_000 });
  if (!fetched) {
    const expired = isMediaLinkExpired(ad);
    return upsertMedia({
      competitorAdId: ad.id,
      status: expired ? "expired" : "unavailable",
      statusReason: expired
        ? `Provider media link expired ${ad.mediaExpiresAt}; re-run miner:ingest to refresh it.`
        : `Download failed or exceeded ${formatMb(CORPUS_MEDIA_MAX_BYTES)}.`,
      sourceUrl: source.url,
      sourceKind: source.kind,
    });
  }
  const resolved = resolveVideoMime(fetched.contentType, fetched.bytes);
  if (!resolved.ok) {
    return upsertMedia({ competitorAdId: ad.id, status: "not_video", statusReason: resolved.reason, sourceUrl: source.url, sourceKind: source.kind, bytes: fetched.bytes.byteLength });
  }

  const sha256 = sha256Hex(fetched.bytes);
  const storagePath = `${ad.id}/${mediaFileName(sha256, resolved.mime)}`;
  const upload = await supabase.storage.from(CORPUS_MEDIA_BUCKET).upload(storagePath, fetched.bytes, { contentType: resolved.mime, upsert: true });
  if (upload.error) {
    const missing = /bucket not found/i.test(upload.error.message);
    throw new Error(missing ? "The corpus-media storage bucket is missing — apply migrations/019_corpus_media_storage.sql." : `Could not store the video: ${upload.error.message}`);
  }

  return upsertMedia({
    competitorAdId: ad.id,
    status: "downloaded",
    statusReason: null,
    sourceUrl: source.url,
    sourceKind: source.kind,
    sha256,
    bytes: fetched.bytes.byteLength,
    mime: resolved.mime,
    storagePath,
    localPath: null,
    downloadedAt: new Date().toISOString(),
  });
}

async function readStoredBytes(media: AdMediaRow): Promise<Buffer> {
  const where = media.storagePath ?? media.localPath;
  if (media.storagePath) {
    const download = await supabase.storage.from(CORPUS_MEDIA_BUCKET).download(media.storagePath);
    if (download.error || !download.data) throw new Error(`Stored video is missing: ${where}. Re-download it (miner:media --force --ad ${media.competitorAdId}).`);
    return Buffer.from(await download.data.arrayBuffer());
  }
  try {
    return await readFile(media.localPath!);
  } catch {
    throw new Error(`Local media file is missing: ${where}. Re-download it (miner:media --force --ad ${media.competitorAdId}).`);
  }
}

/** Read a downloaded video back, refusing a copy whose hash no longer matches the record. */
export async function readAdMedia(media: AdMediaRow): Promise<{ bytes: Buffer; mime: string }> {
  if (media.status !== "downloaded" || !(media.storagePath || media.localPath) || !media.sha256 || !media.mime) {
    throw new Error(`Media for ${media.competitorAdId} is not downloaded (${media.status}${media.statusReason ? `: ${media.statusReason}` : ""}).`);
  }
  const bytes = await readStoredBytes(media);
  if (sha256Hex(bytes) !== media.sha256) {
    throw new Error(`Stored video does not match its recorded sha256: ${media.storagePath ?? media.localPath}.`);
  }
  return { bytes, mime: media.mime };
}
