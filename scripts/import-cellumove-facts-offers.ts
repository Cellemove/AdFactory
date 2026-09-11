import "server-only";

import { buildCellumoveFactsAndOffers, type CellumoveImportProduct } from "../src/lib/cellumove/cellumove-facts-import";
import { supabase } from "../src/lib/db";
import { fetchAllShopifyProducts, readShopifyProductMetadata } from "../src/lib/shopify";

const SITEMAP_INDEX_URL = "https://cellumove.com/sitemap.xml";

function countSitemapUrls(xml: string): number {
  return [...xml.matchAll(/<loc>[^<]+<\/loc>/g)].length;
}

function decodeXml(value: string): string {
  return value.replaceAll("&amp;", "&");
}

function findChildSitemap(indexXml: string, kind: "pages" | "products"): string {
  const locations = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1] ?? ""));
  const location = locations.find((item) => item.includes(`/sitemap_${kind}_`));
  if (!location) throw new Error(`Cellumove's sitemap index does not contain a ${kind} sitemap.`);
  return location;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const refreshExisting = process.argv.includes("--refresh-existing");
  const approverArg = process.argv.find((argument) => argument.startsWith("--approver="));
  const approverUsername = approverArg?.slice("--approver=".length) || "kamino";

  const [projectsResult, productsResult, approverResult, shopifyResult, sitemapIndex] = await Promise.all([
    supabase.from("ScriptProject").select("productId"),
    supabase.from("Product").select("id,name,context"),
    supabase.from("AppUser").select("id,username,role").eq("username", approverUsername).maybeSingle(),
    fetchAllShopifyProducts(),
    fetch(SITEMAP_INDEX_URL, { cache: "no-store" }).then((response) => response.text()),
  ]);
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (approverResult.error) throw new Error(approverResult.error.message);
  if (!approverResult.data || approverResult.data.role !== "creative_strategist") {
    throw new Error(`Approver ${approverUsername} is not an active creative strategist.`);
  }
  const [pageSitemap, productSitemap] = await Promise.all([
    fetch(findChildSitemap(sitemapIndex, "pages"), { cache: "no-store" }).then((response) => response.text()),
    fetch(findChildSitemap(sitemapIndex, "products"), { cache: "no-store" }).then((response) => response.text()),
  ]);

  const usedProductIds = new Set((projectsResult.data ?? []).map((row) => row.productId));
  const liveShopifyById = new Map(shopifyResult.products.map((product) => [product.id, product]));
  const products: CellumoveImportProduct[] = (productsResult.data ?? []).flatMap((product) => {
    if (!usedProductIds.has(product.id)) return [];
    const metadata = readShopifyProductMetadata(product.context);
    if (!metadata || metadata.status !== "active") return [];
    const live = liveShopifyById.get(metadata.productId);
    if (!live) return [];
    return [{
      id: product.id,
      name: product.name,
      metadata: {
        ...metadata,
        title: live.title,
        description: live.description,
        handle: live.handle,
        status: live.status,
        vendor: live.vendor,
        productType: live.productType,
        onlineStoreUrl: live.onlineStoreUrl,
        updatedAt: live.updatedAt,
        options: live.options,
        variants: live.variants,
        images: live.images,
        variantsTruncated: live.variantsTruncated,
      },
    }];
  });
  const plan = buildCellumoveFactsAndOffers(products);
  const report = {
    mode: commit ? "commit" : "dry-run",
    shop: shopifyResult.connection.shopName,
    grantedScopes: shopifyResult.connection.grantedScopes,
    adminProductsInspected: shopifyResult.products.length,
    publicProductUrlsCatalogued: countSitemapUrls(productSitemap),
    publicPageUrlsCatalogued: countSitemapUrls(pageSitemap),
    scorerProductsCovered: products.map((product) => ({ id: product.id, name: product.name, handle: product.metadata.handle })),
    facts: {
      total: plan.facts.length,
      approved: plan.facts.filter((row) => row.status === "approved").length,
      draft: plan.facts.filter((row) => row.status === "draft").length,
    },
    offers: {
      total: plan.offers.length,
      approved: plan.offers.filter((row) => row.status === "approved").length,
      draft: plan.offers.filter((row) => row.status === "draft").length,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!commit) return;

  const now = new Date().toISOString();
  const approvedAudit = { approvedByUserId: approverResult.data.id, approvedAt: now };
  const [existingFactsResult, existingOffersResult] = await Promise.all([
    supabase.from("BrandFact").select("id,status,approvedByUserId,approvedAt,createdAt").in("id", plan.facts.map((row) => row.id)),
    supabase.from("ProductOffer").select("id,status,approvedByUserId,approvedAt,createdAt").in("id", plan.offers.map((row) => row.id)),
  ]);
  if (existingFactsResult.error) throw new Error(existingFactsResult.error.message);
  if (existingOffersResult.error) throw new Error(existingOffersResult.error.message);
  const existingFacts = new Map((existingFactsResult.data ?? []).map((row) => [row.id, row]));
  const existingOffers = new Map((existingOffersResult.data ?? []).map((row) => [row.id, row]));
  const factRows = plan.facts.map((row) => ({
    ...row,
    ...(existingFacts.has(row.id)
      ? {
          status: existingFacts.get(row.id)!.status,
          approvedByUserId: existingFacts.get(row.id)!.approvedByUserId,
          approvedAt: existingFacts.get(row.id)!.approvedAt,
        }
      : row.status === "approved" ? approvedAudit : { approvedByUserId: null, approvedAt: null }),
    createdAt: existingFacts.get(row.id)?.createdAt ?? now,
    updatedAt: now,
  }));
  const offerRows = plan.offers.map((row) => ({
    ...row,
    ...(existingOffers.has(row.id)
      ? {
          status: existingOffers.get(row.id)!.status,
          approvedByUserId: existingOffers.get(row.id)!.approvedByUserId,
          approvedAt: existingOffers.get(row.id)!.approvedAt,
        }
      : row.status === "approved" ? approvedAudit : { approvedByUserId: null, approvedAt: null }),
    createdAt: existingOffers.get(row.id)?.createdAt ?? now,
    updatedAt: now,
  }));

  const factRowsToWrite = refreshExisting ? factRows : factRows.filter((row) => !existingFacts.has(row.id));
  const offerRowsToWrite = refreshExisting ? offerRows : offerRows.filter((row) => !existingOffers.has(row.id));
  if (factRowsToWrite.length) {
    const factWrite = await supabase.from("BrandFact").upsert(factRowsToWrite, { onConflict: "id" });
    if (factWrite.error) throw new Error(`BrandFact: ${factWrite.error.message}`);
  }
  if (offerRowsToWrite.length) {
    const offerWrite = await supabase.from("ProductOffer").upsert(offerRowsToWrite, { onConflict: "id" });
    if (offerWrite.error) throw new Error(`ProductOffer: ${offerWrite.error.message}`);
  }
  console.log(`Committed ${factRowsToWrite.length} facts and ${offerRowsToWrite.length} offers. Existing entries were ${refreshExisting ? "refreshed" : "preserved"}; approved new rows are attributed to ${approverUsername}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
