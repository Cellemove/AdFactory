import type { Metadata } from "next";
import { ProductsSection } from "@/app/avatars/ProductsSection";
import { requireStrategist } from "@/lib/authorization";
import { supabase, unwrap } from "@/lib/db";
import { getShopifyConfigStatus, readShopifyProductMetadata } from "@/lib/shopify";
import { readAdFactoryProductOverrides } from "@/lib/product-overrides";
import { ShopifyConnectionPanel } from "./ShopifyConnectionPanel";

export const metadata: Metadata = {
  title: "Products · AdFactory",
  description: "Manage the products available to AdFactory scripts and campaigns.",
};

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requireStrategist();
  const shopifyConfig = getShopifyConfigStatus();
  const products = unwrap(
    await supabase.from("Product").select("*").order("createdAt", { ascending: false }),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Product catalogue</h1>
        <p className="mt-1 text-sm text-ink-500">
          Add every product once, then reuse it across scripts, avatars, research, and campaigns.
        </p>
      </header>

      <ShopifyConnectionPanel config={shopifyConfig} />

      <ProductsSection
        products={products.map((product) => {
          const shopify = readShopifyProductMetadata(product.context);
          return {
            id: product.id,
            name: product.name,
            code: product.code ?? "",
            imagePath: product.imagePath,
            description: product.description,
            sourceLabel: shopify ? "Shopify" : undefined,
            hasLocalOverrides: Boolean(readAdFactoryProductOverrides(product.context)),
            images: shopify?.images ?? [],
          };
        })}
        showHeading={false}
      />
    </div>
  );
}
