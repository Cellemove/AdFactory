"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ProductRow } from "@/lib/database.types";
import { supabase, unwrap, newId } from "@/lib/db";
import { saveImage } from "@/lib/storage";
import { requireStrategist } from "@/lib/authorization";
import {
  checkShopifyConnection,
} from "@/lib/shopify";
import { syncShopifyCatalogue } from "@/lib/shopify-sync";
import { readShopifyProductMetadata } from "@/lib/shopify";
import {
  buildAdFactoryProductOverrides,
  writeAdFactoryProductOverrides,
} from "@/lib/product-overrides";

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ProductCodeSchema = z.string().trim().max(20).regex(/^[a-zA-Z0-9]*$/, "Use letters and numbers only.");

const CreateProductSchema = z.object({
  name: z.string().min(1).max(120),
  code: ProductCodeSchema,
  imagePath: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const UpdateProductSchema = CreateProductSchema.extend({
  id: z.string().min(1),
});

export async function createProduct(input: z.infer<typeof CreateProductSchema>) {
  await requireStrategist();
  const parsed = CreateProductSchema.parse(input);
  const now = new Date().toISOString();
  const created = unwrap(
    await supabase
      .from("Product")
      .insert({
        id: newId(),
        name: parsed.name,
        code: parsed.code ? parsed.code.toUpperCase() : null,
        imagePath: parsed.imagePath ?? null,
        description: parsed.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .select("*")
      .single(),
  );
  revalidatePath("/avatars");
  revalidatePath("/products");
  return created;
}

function revalidateProductPages() {
  revalidatePath("/avatars");
  revalidatePath("/products");
  revalidatePath("/scripts/new");
}

export async function updateProduct(input: z.infer<typeof UpdateProductSchema>) {
  await requireStrategist();
  const parsed = UpdateProductSchema.parse(input);
  const current = unwrap(
    await supabase.from("Product").select("*").eq("id", parsed.id).single(),
  ) as ProductRow | null;
  if (!current) throw new Error("Product not found.");
  const shopify = readShopifyProductMetadata(current.context);
  const now = new Date().toISOString();
  let context = current.context;

  if (shopify) {
    if (typeof shopify.title !== "string" || typeof shopify.description !== "string") {
      throw new Error("Refresh Shopify products once before creating local overrides for this product.");
    }
    const overrides = buildAdFactoryProductOverrides(
      {
        name: parsed.name,
        description: parsed.description ?? null,
        imagePath: parsed.imagePath ?? null,
      },
      {
        title: shopify.title,
        description: shopify.description || null,
        featuredImageUrl: shopify.featuredImageUrl ?? null,
      },
      now,
    );
    context = writeAdFactoryProductOverrides(current.context, overrides);
  }

  const updated = unwrap(
    await supabase
      .from("Product")
      .update({
        name: parsed.name,
        code: parsed.code ? parsed.code.toUpperCase() : null,
        description: parsed.description ?? null,
        imagePath: parsed.imagePath ?? null,
        context,
        updatedAt: now,
      })
      .eq("id", parsed.id)
      .select("*")
      .single(),
  );
  revalidateProductPages();
  return updated;
}

export async function resetProductToShopify(id: string) {
  await requireStrategist();
  const current = unwrap(
    await supabase.from("Product").select("*").eq("id", id).single(),
  ) as ProductRow | null;
  if (!current) throw new Error("Product not found.");
  const shopify = readShopifyProductMetadata(current.context);
  if (!shopify) throw new Error("This product is not linked to Shopify.");
  if (typeof shopify.title !== "string" || typeof shopify.description !== "string") {
    throw new Error("Refresh Shopify products once before resetting this product.");
  }
  const now = new Date().toISOString();
  const updated = unwrap(
    await supabase
      .from("Product")
      .update({
        name: shopify.title,
        description: shopify.description || null,
        imagePath: shopify.featuredImageUrl ?? null,
        context: writeAdFactoryProductOverrides(current.context, null),
        updatedAt: now,
      })
      .eq("id", id)
      .select("*")
      .single(),
  );
  revalidateProductPages();
  return updated;
}

export async function deleteProduct(id: string) {
  await requireStrategist();
  const { error } = await supabase.from("Product").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/avatars");
  revalidatePath("/products");
}

export async function uploadProductImage(formData: FormData): Promise<{ imagePath: string }> {
  await requireStrategist();
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

export async function testShopifyProductsConnection() {
  await requireStrategist();
  return checkShopifyConnection();
}

export async function syncShopifyProducts() {
  await requireStrategist();
  const result = await syncShopifyCatalogue();

  revalidatePath("/avatars");
  revalidatePath("/products");
  revalidatePath("/scripts/new");
  return result;
}
