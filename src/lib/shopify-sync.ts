import "server-only";

import { newId, supabase, unwrap } from "@/lib/db";
import {
  fetchAllShopifyProducts,
  mergeShopifyProductContext,
  readShopifyProductMetadata,
} from "@/lib/shopify";
import { readAdFactoryProductOverrides, resolveProductFields } from "@/lib/product-overrides";

export interface ShopifySyncResult {
  shopName: string;
  storeDomain: string;
  total: number;
  created: number;
  updated: number;
  truncatedVariantProducts: number;
  syncedAt: string;
}

export async function syncShopifyCatalogue(): Promise<ShopifySyncResult> {
  const { connection, products } = await fetchAllShopifyProducts();
  const existing = unwrap(await supabase.from("Product").select("*"));
  const existingByShopifyId = new Map(
    existing.flatMap((product) => {
      const metadata = readShopifyProductMetadata(product.context);
      return metadata?.storeDomain === connection.storeDomain
        ? [[metadata.productId, product] as const]
        : [];
    }),
  );
  const syncedAt = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let truncatedVariantProducts = 0;

  for (const product of products) {
    const current = existingByShopifyId.get(product.id);
    const metadata = {
      storeDomain: connection.storeDomain,
      productId: product.id,
      title: product.title,
      description: product.description,
      featuredImageUrl: product.featuredImageUrl,
      handle: product.handle,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      onlineStoreUrl: product.onlineStoreUrl,
      updatedAt: product.updatedAt,
      syncedAt,
      options: product.options,
      variants: product.variants,
      images: product.images,
      variantsTruncated: product.variantsTruncated,
    };
    if (product.variantsTruncated) truncatedVariantProducts += 1;

    if (current) {
      const resolved = resolveProductFields(
        {
          title: product.title,
          description: product.description || null,
          featuredImageUrl: product.featuredImageUrl,
        },
        readAdFactoryProductOverrides(current.context),
      );
      unwrap(
        await supabase
          .from("Product")
          .update({
            name: resolved.name,
            description: resolved.description,
            imagePath: resolved.imagePath,
            context: mergeShopifyProductContext(current.context, metadata),
            updatedAt: syncedAt,
          })
          .eq("id", current.id)
          .select("*")
          .single(),
      );
      updated += 1;
    } else {
      unwrap(
        await supabase
          .from("Product")
          .insert({
            id: newId(),
            name: product.title,
            code: null,
            description: product.description || null,
            imagePath: product.featuredImageUrl,
            context: mergeShopifyProductContext(undefined, metadata),
            createdAt: syncedAt,
            updatedAt: syncedAt,
          })
          .select("*")
          .single(),
      );
      created += 1;
    }
  }

  return {
    shopName: connection.shopName,
    storeDomain: connection.storeDomain,
    total: products.length,
    created,
    updated,
    truncatedVariantProducts,
    syncedAt,
  };
}
