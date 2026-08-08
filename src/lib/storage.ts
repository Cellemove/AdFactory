import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

// Image storage abstraction.
// - On Vercel (or when BLOB_READ_WRITE_TOKEN is set): writes to Vercel Blob, returns the absolute public URL.
// - Locally without the token: writes to public/uploads/<prefix>/ and returns a /uploads/... path.
// Returned URL/path is what gets stored in the DB and rendered into <img src>.

export interface SaveImageInput {
  prefix: "winners" | "products" | "winners-import";
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
