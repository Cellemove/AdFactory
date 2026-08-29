"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  syncShopifyProducts,
  testShopifyProductsConnection,
} from "@/app/actions/products";
import type { ShopifyConfigStatus } from "@/lib/shopify";

interface ConnectionMessage {
  tone: "success" | "error";
  text: string;
}

export function ShopifyConnectionPanel({ config }: { config: ShopifyConfigStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<ConnectionMessage | null>(null);

  const testConnection = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await testShopifyProductsConnection();
        setMessage({
          tone: "success",
          text: `Connected to ${result.shopName} (${result.storeDomain}). read_products is granted.`,
        });
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  };

  const syncProducts = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await syncShopifyProducts();
        const variantWarning = result.truncatedVariantProducts
          ? ` ${result.truncatedVariantProducts} product(s) have more than 100 variants; the first 100 were imported.`
          : "";
        setMessage({
          tone: "success",
          text: `Synced ${result.total} products from ${result.shopName}: ${result.created} added, ${result.updated} refreshed.${variantWarning}`,
        });
        router.refresh();
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Shopify catalogue</h2>
            <span className={config.configured ? "tag tag-ok" : "tag tag-warn"}>
              {config.configured ? "Configured" : "Needs setup"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            One-way import from Shopify. AdFactory keeps its naming codes and existing script links.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!config.configured || isPending} onClick={testConnection}>
            {isPending ? "Working…" : "Test connection"}
          </button>
          <button className="btn btn-primary" disabled={!config.configured || isPending} onClick={syncProducts}>
            {isPending ? "Syncing…" : "Import / refresh products"}
          </button>
        </div>
      </div>

      {config.configured ? (
        <dl className="grid gap-3 rounded-xl bg-ink-50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-ink-500">Store</dt><dd className="mt-0.5 font-medium">{config.storeDomain}</dd></div>
          <div><dt className="text-xs text-ink-500">Authentication</dt><dd className="mt-0.5 font-medium">{config.authMode === "access_token" ? "Admin access token" : "Client credentials"}</dd></div>
          <div><dt className="text-xs text-ink-500">Admin API</dt><dd className="mt-0.5 font-medium">{config.apiVersion}</dd></div>
        </dl>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Add the Shopify connection to the server environment.</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5">
            <li>Create or install a Shopify app with only the <code>read_products</code> scope.</li>
            <li>Set <code>SHOPIFY_STORE_DOMAIN</code> to the permanent <code>*.myshopify.com</code> domain.</li>
            <li>Set <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code>, or use <code>SHOPIFY_CLIENT_ID</code> and <code>SHOPIFY_CLIENT_SECRET</code>.</li>
            <li>Restart AdFactory, then test the connection before importing.</li>
          </ol>
          {config.error && <p className="mt-2 font-medium text-red-800">{config.error}</p>}
          {config.missing.length > 0 && <p className="mt-2 text-xs">Missing: {config.missing.join(", ")}</p>}
        </div>
      )}

      <p className="text-xs text-ink-500">
        Shopify titles, descriptions, images, status, options, and variants refresh on every sync. AdFactory never writes back to Shopify.
      </p>
      {message && (
        <div className={`rounded-xl border p-3 text-sm ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          {message.text}
        </div>
      )}
    </section>
  );
}
