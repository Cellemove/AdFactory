import "server-only";

import type { Json } from "@/lib/database.types";

const DEFAULT_API_VERSION = "2026-07";
const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const API_VERSION_PATTERN = /^\d{4}-(01|04|07|10)$/;
const REQUEST_TIMEOUT_MS = 20_000;

type ShopifyAuthMode = "access_token" | "client_credentials";

interface ShopifyConfig {
  storeDomain: string;
  apiVersion: string;
  authMode: ShopifyAuthMode;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ShopifyConfigStatus {
  configured: boolean;
  storeDomain: string | null;
  apiVersion: string;
  authMode: ShopifyAuthMode | null;
  missing: string[];
  error: string | null;
}

export interface ShopifyConnectionResult {
  shopName: string;
  storeDomain: string;
  apiVersion: string;
  grantedScopes: string[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  price: string;
  compareAtPrice: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  imageUrl: string | null;
}

export interface ShopifyProductImage {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  productType: string;
  status: string;
  onlineStoreUrl: string | null;
  updatedAt: string;
  featuredImageUrl: string | null;
  options: Array<{ name: string; values: string[] }>;
  variants: ShopifyVariant[];
  images: ShopifyProductImage[];
  variantsTruncated: boolean;
}

export interface ShopifyProductMetadata {
  storeDomain: string;
  productId: string;
  title?: string;
  description?: string;
  featuredImageUrl?: string | null;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  onlineStoreUrl: string | null;
  updatedAt: string;
  syncedAt: string;
  options: Array<{ name: string; values: string[] }>;
  variants: ShopifyVariant[];
  images?: ShopifyProductImage[];
  variantsTruncated: boolean;
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface ShopifyProductsPage {
  products: {
    nodes: Array<{
      id: string;
      title: string;
      handle: string;
      description: string;
      vendor: string;
      productType: string;
      status: string;
      onlineStoreUrl: string | null;
      updatedAt: string;
      featuredImage: { url: string } | null;
      options: Array<{ name: string; values: string[] }>;
      variants: {
        nodes: ShopifyVariantNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
      media: {
        nodes: ShopifyMediaNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface ShopifyVariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  price: string;
  compareAtPrice: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string } | null;
}

interface ShopifyMediaNode {
  id: string;
  mediaContentType: string;
  alt: string | null;
  image?: {
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
  } | null;
}

let cachedClientToken: { token: string; expiresAt: number } | null = null;

function cleanStoreDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getShopifyConfigStatus(): ShopifyConfigStatus {
  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim() ?? "";
  const storeDomain = rawDomain ? cleanStoreDomain(rawDomain) : null;
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const missing: string[] = [];

  if (!storeDomain) missing.push("SHOPIFY_STORE_DOMAIN");
  if (!accessToken && !(clientId && clientSecret)) {
    missing.push("SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET");
  } else if (!accessToken) {
    if (!clientId) missing.push("SHOPIFY_CLIENT_ID");
    if (!clientSecret) missing.push("SHOPIFY_CLIENT_SECRET");
  }

  let error: string | null = null;
  if (storeDomain && !SHOPIFY_DOMAIN_PATTERN.test(storeDomain)) {
    error = "SHOPIFY_STORE_DOMAIN must be the permanent .myshopify.com domain.";
  } else if (!API_VERSION_PATTERN.test(apiVersion)) {
    error = "SHOPIFY_API_VERSION must use Shopify's YYYY-MM format, such as 2026-07.";
  }

  return {
    configured: missing.length === 0 && !error,
    storeDomain,
    apiVersion,
    authMode: accessToken ? "access_token" : clientId && clientSecret ? "client_credentials" : null,
    missing,
    error,
  };
}

function getShopifyConfig(): ShopifyConfig {
  const status = getShopifyConfigStatus();
  if (!status.configured || !status.storeDomain || !status.authMode) {
    const detail = status.error ?? `Missing ${status.missing.join(", ")}.`;
    throw new Error(`Shopify is not configured. ${detail}`);
  }

  return {
    storeDomain: status.storeDomain,
    apiVersion: status.apiVersion,
    authMode: status.authMode,
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim(),
    clientId: process.env.SHOPIFY_CLIENT_ID?.trim(),
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET?.trim(),
  };
}

async function getAccessToken(config: ShopifyConfig): Promise<string> {
  if (config.authMode === "access_token") return config.accessToken!;

  if (cachedClientToken && cachedClientToken.expiresAt > Date.now() + 60_000) {
    return cachedClientToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
  });
  const response = await fetch(`https://${config.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const rawPayload = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(rawPayload) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
    } catch {
      return null;
    }
  })();

  if (!response.ok || !payload?.access_token) {
    if (rawPayload.includes("app_not_installed")) {
      throw new Error(
        "The Shopify app is not installed on SHOPIFY_STORE_DOMAIN. Install its released version on that store, or correct the store domain, then test again.",
      );
    }
    if (rawPayload.includes("invalid_client")) {
      throw new Error("Shopify rejected the client ID or client secret. Check the Dev Dashboard credentials.");
    }
    throw new Error(
      payload?.error_description || payload?.error || `Shopify authentication failed (${response.status}).`,
    );
  }

  const expiresIn = Math.max(60, payload.expires_in ?? 86_399);
  cachedClientToken = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return payload.access_token;
}

/*
 * Keep this function immediately below token acquisition: every Admin API call
 * must use the same validated store, API version, and server-only token path.
 */
async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const config = getShopifyConfig();
  const token = await getAccessToken(config);
  const response = await fetch(`https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as GraphqlEnvelope<T> | null;

  if (!response.ok) {
    throw new Error(`Shopify Admin API request failed (${response.status}). Check the store domain and credentials.`);
  }
  if (!payload) throw new Error("Shopify returned an unreadable response.");
  if (payload.errors?.length) {
    throw new Error(`Shopify: ${payload.errors.map((item) => item.message || "Unknown GraphQL error").join("; ")}`);
  }
  if (!payload.data) throw new Error("Shopify returned no data.");
  return payload.data;
}

export async function checkShopifyConnection(): Promise<ShopifyConnectionResult> {
  const config = getShopifyConfig();
  const data = await shopifyGraphql<{
    shop: { name: string; myshopifyDomain: string };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
  }>(`#graphql
    query AdFactoryShopifyConnection {
      shop { name myshopifyDomain }
      currentAppInstallation { accessScopes { handle } }
    }
  `);
  const grantedScopes = data.currentAppInstallation.accessScopes.map((scope) => scope.handle).sort();
  if (!grantedScopes.includes("read_products") && !grantedScopes.includes("write_products")) {
    throw new Error("The installed Shopify app has not been granted read_products. Update its scopes, then reinstall or reauthorize it.");
  }

  return {
    shopName: data.shop.name,
    storeDomain: data.shop.myshopifyDomain,
    apiVersion: config.apiVersion,
    grantedScopes,
  };
}

export async function fetchAllShopifyProducts(): Promise<{
  connection: ShopifyConnectionResult;
  products: ShopifyProduct[];
}> {
  const connection = await checkShopifyConnection();
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;

  do {
    const data: ShopifyProductsPage = await shopifyGraphql<ShopifyProductsPage>(`#graphql
      query AdFactoryProducts($after: String) {
        products(first: 100, after: $after, sortKey: UPDATED_AT) {
          nodes {
            id title handle description vendor productType status onlineStoreUrl updatedAt
            featuredImage { url }
            options { name values }
            variants(first: 100) {
              nodes {
                id title sku barcode availableForSale price compareAtPrice
                selectedOptions { name value }
                image { url }
              }
              pageInfo { hasNextPage endCursor }
            }
            media(first: 100) {
              nodes {
                id mediaContentType alt
                ... on MediaImage {
                  image { url altText width height }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after: cursor });

    for (const product of data.products.nodes) {
      const variants = product.variants.nodes.map(toShopifyVariant);
      let variantCursor = product.variants.pageInfo.hasNextPage
        ? product.variants.pageInfo.endCursor
        : null;

      while (variantCursor) {
        const variantPage: {
          product: {
            variants: {
              nodes: ShopifyVariantNode[];
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          } | null;
        } = await shopifyGraphql(` #graphql
          query AdFactoryProductVariants($productId: ID!, $after: String) {
            product(id: $productId) {
              variants(first: 100, after: $after) {
                nodes {
                  id title sku barcode availableForSale price compareAtPrice
                  selectedOptions { name value }
                  image { url }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        `, { productId: product.id, after: variantCursor });
        if (!variantPage.product) throw new Error(`Shopify product ${product.id} disappeared during sync.`);
        variants.push(...variantPage.product.variants.nodes.map(toShopifyVariant));
        variantCursor = variantPage.product.variants.pageInfo.hasNextPage
          ? variantPage.product.variants.pageInfo.endCursor
          : null;
      }

      const images = product.media.nodes.flatMap(toShopifyProductImage);
      let mediaCursor = product.media.pageInfo.hasNextPage
        ? product.media.pageInfo.endCursor
        : null;

      while (mediaCursor) {
        const mediaPage: {
          product: {
            media: {
              nodes: ShopifyMediaNode[];
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          } | null;
        } = await shopifyGraphql(` #graphql
          query AdFactoryProductMedia($productId: ID!, $after: String) {
            product(id: $productId) {
              media(first: 100, after: $after) {
                nodes {
                  id mediaContentType alt
                  ... on MediaImage {
                    image { url altText width height }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        `, { productId: product.id, after: mediaCursor });
        if (!mediaPage.product) throw new Error(`Shopify product ${product.id} disappeared during media sync.`);
        images.push(...mediaPage.product.media.nodes.flatMap(toShopifyProductImage));
        mediaCursor = mediaPage.product.media.pageInfo.hasNextPage
          ? mediaPage.product.media.pageInfo.endCursor
          : null;
      }

      products.push({
        id: product.id,
        title: product.title,
        handle: product.handle,
        description: product.description,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status.toLowerCase(),
        onlineStoreUrl: product.onlineStoreUrl,
        updatedAt: product.updatedAt,
        featuredImageUrl: product.featuredImage?.url ?? null,
        options: product.options,
        variants,
        images: deduplicateProductImages(images),
        variantsTruncated: false,
      });
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return { connection, products };
}

function toShopifyVariant(variant: ShopifyVariantNode): ShopifyVariant {
  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    availableForSale: variant.availableForSale,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    selectedOptions: variant.selectedOptions,
    imageUrl: variant.image?.url ?? null,
  };
}

function toShopifyProductImage(media: ShopifyMediaNode): ShopifyProductImage[] {
  if (media.mediaContentType !== "IMAGE" || !media.image?.url) return [];
  return [{
    id: media.id,
    url: media.image.url,
    altText: media.image.altText ?? media.alt ?? null,
    width: media.image.width ?? null,
    height: media.image.height ?? null,
  }];
}

function deduplicateProductImages(images: ShopifyProductImage[]): ShopifyProductImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = image.id || image.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readShopifyProductMetadata(context: Json | undefined): ShopifyProductMetadata | null {
  if (!isObject(context) || !isObject(context.shopify)) return null;
  const shopify = context.shopify;
  if (typeof shopify.productId !== "string" || typeof shopify.storeDomain !== "string") return null;
  return shopify as unknown as ShopifyProductMetadata;
}

export function mergeShopifyProductContext(
  current: Json | undefined,
  metadata: ShopifyProductMetadata,
): Json {
  const base = isObject(current) ? current : {};
  return { ...base, shopify: metadata as unknown as Json };
}
