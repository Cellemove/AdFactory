import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { supabase } from "@/lib/db";

// Image storage, backed by Supabase Storage — the same service the rest of the
// app already authenticates against, so there is no second provider to keep
// credentialled and local dev behaves exactly like production.
//
// Objects live at <prefix>/<filename> in a public bucket, and the returned URL
// is what gets stored in the DB and rendered into <img src>.

export const AD_IMAGE_BUCKET = "ad-images";

export interface SaveImageInput {
  prefix: "winners" | "products" | "winners-import" | "image-ad-references" | "image-ad-candidates";
  filename: string;
  bytes: Buffer;
  contentType: string;
}

export async function saveImage({ prefix, filename, bytes, contentType }: SaveImageInput): Promise<{ url: string }> {
  const objectPath = `${prefix}/${filename}`;
  const upload = await supabase.storage
    .from(AD_IMAGE_BUCKET)
    // Callers already put a UUID in the filename, so upsert only matters when a
    // retry re-uploads the identical object.
    .upload(objectPath, bytes, { contentType, upsert: true });

  if (upload.error) {
    const missing = /bucket not found/i.test(upload.error.message);
    throw new Error(
      missing
        ? `The "${AD_IMAGE_BUCKET}" storage bucket is missing — apply migrations/025_ad_image_storage.sql.`
        : `Could not store the image: ${upload.error.message}`,
    );
  }

  return { url: supabase.storage.from(AD_IMAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl };
}

// Stored image references come in three shapes, because rows predate this
// module's history: a Supabase object URL (current), an absolute URL from the
// old blob store, and a /uploads/... path from the old local-disk fallback.
function supabaseObjectPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${AD_IMAGE_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
}

function legacyLocalPath(url: string): string | null {
  return url.startsWith("/uploads/") ? path.join(process.cwd(), "public", url) : null;
}

// Does a stored image still resolve? Used before trusting a previously saved
// copy, which can be absent if the bucket was cleared or the row was written on
// another machine back when images went to local disk.
export async function storedImageExists(url: string): Promise<boolean> {
  const objectPath = supabaseObjectPath(url);
  if (objectPath) {
    const folder = objectPath.includes("/") ? objectPath.slice(0, objectPath.lastIndexOf("/")) : "";
    const name = objectPath.slice(objectPath.lastIndexOf("/") + 1);
    const listed = await supabase.storage.from(AD_IMAGE_BUCKET).list(folder, { search: name, limit: 100 });
    if (listed.error) return false;
    return (listed.data ?? []).some((entry) => entry.name === name);
  }

  const local = legacyLocalPath(url);
  if (local) {
    try {
      return (await stat(local)).size > 0;
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function readStoredImage(url: string): Promise<Buffer> {
  const objectPath = supabaseObjectPath(url);
  if (objectPath) {
    const download = await supabase.storage.from(AD_IMAGE_BUCKET).download(objectPath);
    if (download.error || !download.data) {
      throw new Error(`Stored image is missing: ${objectPath}`);
    }
    return Buffer.from(await download.data.arrayBuffer());
  }

  const local = legacyLocalPath(url);
  if (local) return readFile(local);

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not read stored image (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
