import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

// Image storage abstraction.
// - On Vercel (or when BLOB_READ_WRITE_TOKEN is set): writes to Vercel Blob, returns the absolute public URL.
// - Locally without the token: writes to public/uploads/<prefix>/ and returns a /uploads/... path.
// Returned URL/path is what gets stored in the DB and rendered into <img src>.

export interface SaveImageInput {
  prefix: "winners" | "products" | "winners-import" | "image-ad-references" | "image-ad-candidates";
  filename: string;
  bytes: Buffer;
  contentType: string;
}

export async function saveImage({ prefix, filename, bytes, contentType }: SaveImageInput): Promise<{ url: string }> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${prefix}/${filename}`, bytes, {
      access: "public",
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });
    return { url: blob.url };
  }
  // On Vercel/serverless, public/ is read-only at runtime — refuse to fall back.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      "Image upload misconfigured: BLOB_READ_WRITE_TOKEN is not set on this deployment. " +
      "Provision a Vercel Blob store (Project → Storage → Create → Blob → Connect) and redeploy.",
    );
  }
  const dir = path.join(process.cwd(), "public", "uploads", prefix);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return { url: `/uploads/${prefix}/${filename}` };
}

// Local-fallback URLs are paths under public/; blob URLs are absolute. Both forms
// end up in the DB, so readers have to handle either.
function localPathFor(url: string): string | null {
  return url.startsWith("/uploads/") ? path.join(process.cwd(), "public", url) : null;
}

// Does a stored image still resolve? Used before trusting a previously saved
// copy: a blob store can be rotated, and local uploads/ is gitignored, so an
// image saved on another machine is simply absent here.
export async function storedImageExists(url: string): Promise<boolean> {
  const local = localPathFor(url);
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
  const local = localPathFor(url);
  if (local) return readFile(local);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not read stored image (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
