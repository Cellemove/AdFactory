"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, newId } from "@/lib/db";
import { saveImage } from "@/lib/storage";

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CreateProductSchema = z.object({
  name: z.string().min(1).max(120),
  imagePath: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export async function createProduct(input: z.infer<typeof CreateProductSchema>) {
  const parsed = CreateProductSchema.parse(input);
  const now = new Date().toISOString();
  const created = unwrap(
    await supabase
      .from("Product")
      .insert({
        id: newId(),
        name: parsed.name,
        imagePath: parsed.imagePath ?? null,
        description: parsed.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .select("*")
      .single(),
  );
  revalidatePath("/avatars");
  return created;
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.from("Product").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/avatars");
}

export async function uploadProductImage(formData: FormData): Promise<{ imagePath: string }> {
  const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("No image file uploaded.");
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}. Use PNG, JPEG, WEBP, or GIF.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB).`);
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".png";
  const filename = `${randomUUID()}${safeExt}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { url } = await saveImage({
    prefix: "products",
    filename,
    bytes,
    contentType: file.type,
  });
  return { imagePath: url };
}
