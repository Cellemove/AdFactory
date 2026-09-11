import { createHash } from "node:crypto";
import type { ShopifyProductMetadata } from "@/lib/shopify";

export type EvidenceStatus = "approved" | "draft";

export type CellumoveImportProduct = {
  id: string;
  name: string;
  metadata: ShopifyProductMetadata;
};

export type CellumoveFactSeed = {
  id: string;
  productId: string;
  marketCode: string | null;
  factType: string;
  statement: string;
  normalizedStatement: string;
  sourceUrl: string;
  status: EvidenceStatus;
};

export type CellumoveOfferSeed = {
  id: string;
  productId: string;
  marketCode: string | null;
  offerType: string;
  statement: string;
  sourceUrl: string;
  status: EvidenceStatus;
  validFrom: string | null;
  validUntil: string | null;
};

export const CELLUMOVE_HOMEPAGE_URL = "https://cellumove.com/pages/homepage-v2";
export const CELLUMOVE_SHIPPING_URL = "https://cellumove.com/pages/shipping-policy-cellumove";
export const CELLUMOVE_REFUND_URL = "https://cellumove.com/pages/refund-policy";
export const CELLUMOVE_TERMS_URL = "https://cellumove.com/pages/terms-and-conditions-of-sale-cellumove";
export const CELLUMOVE_CONTACT_URL = "https://cellumove.com/pages/contact";

function normalizeStatement(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableId(kind: "fact" | "offer", productId: string, type: string, sourceUrl: string): string {
  const prefix = kind === "fact" ? "cf" : "co";
  const hash = createHash("sha256").update(`${kind}:${productId}:${type}:${sourceUrl}`).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

function fact(
  productId: string,
  factType: string,
  statement: string,
  sourceUrl: string,
  status: EvidenceStatus = "approved",
  marketCode: string | null = null,
): CellumoveFactSeed {
  return {
    id: stableId("fact", productId, factType, sourceUrl),
    productId,
    marketCode,
    factType,
    statement,
    normalizedStatement: normalizeStatement(statement),
    sourceUrl,
    status,
  };
}

function offer(
  productId: string,
  offerType: string,
  statement: string,
  sourceUrl: string,
  status: EvidenceStatus = "approved",
  marketCode: string | null = null,
): CellumoveOfferSeed {
  return {
    id: stableId("offer", productId, offerType, sourceUrl),
    productId,
    marketCode,
    offerType,
    statement,
    sourceUrl,
    status,
    validFrom: null,
    validUntil: null,
  };
}

function option(metadata: ShopifyProductMetadata, pattern: RegExp): string[] {
  return metadata.options.find((item) => pattern.test(item.name))?.values ?? [];
}

function publicProductUrl(metadata: ShopifyProductMetadata): string {
  return metadata.onlineStoreUrl || `https://cellumove.com/products/${encodeURIComponent(metadata.handle)}`;
}

function buildPriceOffers(product: CellumoveImportProduct): CellumoveOfferSeed[] {
  const { metadata } = product;
  const title = metadata.title?.trim() || product.name;
  const sourceUrl = publicProductUrl(metadata);
  const prices = [...new Set(metadata.variants.map((variant) => variant.price).filter(Boolean))];
  const compareAtPrices = [...new Set(metadata.variants.map((variant) => variant.compareAtPrice).filter((value): value is string => Boolean(value)))];
  if (!prices.length) return [];

  if (prices.length === 1) {
    const compareAt = compareAtPrices.length === 1 ? `, compared with £${compareAtPrices[0]}` : "";
    return [offer(
      product.id,
      "current_uk_catalog_price",
      `The current UK storefront price is £${prices[0]}${compareAt} for the listed variants of ${title}.`,
      sourceUrl,
      "approved",
      "UK",
    )];
  }

  const styleValues = option(metadata, /^style$/i);
  const byStyle = styleValues.flatMap((style) => {
    const stylePrices = [...new Set(metadata.variants
      .filter((variant) => variant.selectedOptions.some((item) => item.name.toLowerCase() === "style" && item.value === style))
      .map((variant) => variant.price))];
    if (stylePrices.length !== 1) return [];
    return [offer(
      product.id,
      `current_uk_catalog_price_${normalizeStatement(style).replaceAll(" ", "_")}`,
      `The current UK storefront price is £${stylePrices[0]} for ${style} variants of ${title}.`,
      sourceUrl,
      "approved",
      "UK",
    )];
  });
  if (byStyle.length) return byStyle;

  return [offer(
    product.id,
    "current_uk_catalog_price_range",
    `Current UK storefront prices for ${title} range from £${prices.sort((a, b) => Number(a) - Number(b))[0]} to £${prices.at(-1)} depending on the selected variant.`,
    sourceUrl,
    "approved",
    "UK",
  )];
}

export function buildCellumoveFactsAndOffers(products: CellumoveImportProduct[]): {
  facts: CellumoveFactSeed[];
  offers: CellumoveOfferSeed[];
} {
  const facts: CellumoveFactSeed[] = [];
  const offers: CellumoveOfferSeed[] = [];

  for (const product of products) {
    const sourceUrl = publicProductUrl(product.metadata);
    const title = product.metadata.title?.trim() || product.name;
    const description = product.metadata.description?.trim() || "";
    const colors = option(product.metadata, /^colou?r$/i);
    const sizes = option(product.metadata, /^size$/i);
    const styles = option(product.metadata, /^style$/i);

    facts.push(fact(product.id, "official_catalog_name", `The official Shopify catalog name is “${title}”.`, sourceUrl));
    if (description) {
      facts.push(fact(product.id, "official_catalog_description", description, sourceUrl));
    }
    if (colors.length) facts.push(fact(product.id, "available_colors", `Listed colors: ${colors.join(", ")}.`, sourceUrl));
    if (sizes.length) facts.push(fact(product.id, "available_sizes", `Listed sizes: ${sizes.join(", ")}.`, sourceUrl));
    if (styles.length) facts.push(fact(product.id, "available_styles", `Listed styles: ${styles.join(", ")}.`, sourceUrl));

    const looksLikeCompressionLegging = /legging|compression/i.test(`${product.name} ${title} ${description}`);
    if (looksLikeCompressionLegging) {
      facts.push(
        fact(product.id, "texture_design", "The raised honeycomb 3D™ texture is designed to stay in contact with the legs throughout the day.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "movement_mechanism", "As the wearer moves, the raised texture is designed to press gently against the skin and create a continuous hands-free micro-massage.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "compression_profile", "The compression is described as firmest at the ankle and progressively lighter higher up the leg.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "brand_product_design", "Cellumove describes its 3D™ technology as combining textured fabric, targeted compression, and sculpting support.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "customer_support_contact", "Customer support is available at contact@cellumove.com, and the contact page states that replies are provided within 72 hours.", CELLUMOVE_CONTACT_URL),
        fact(product.id, "first_wear_outcome_claim_review", "Cellumove claims smoother, firmer, lighter legs from the first wear.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "cellulite_outcome_claim_review", "Cellumove claims the product is designed to smooth the look of cellulite with every week of movement.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "daily_outcome_claim_review", "Cellumove claims the first result a wearer feels is lighter legs by evening, with smoother-looking results building over time.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "social_proof_claim_review", "The homepage claims the products are loved by more than 100,000 women.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "squat_proof_claim_review", "The homepage describes the 3D™ knit as squat-proof.", CELLUMOVE_HOMEPAGE_URL, "draft"),
      );
    }

    facts.push(
      fact(product.id, "manufacturing_location", "Cellumove's terms state that its products are manufactured by a partner factory in Asia.", CELLUMOVE_TERMS_URL),
      fact(product.id, "factory_standards_claim_review", "Cellumove claims its partner factory follows strict hygiene and fair working-condition standards.", CELLUMOVE_TERMS_URL, "draft"),
    );

    offers.push(
      ...buildPriceOffers(product),
      offer(product.id, "free_standard_shipping", "Standard shipping is free for orders placed on the Cellumove website.", CELLUMOVE_SHIPPING_URL),
      offer(product.id, "order_processing_time", "Orders are generally processed within 1 to 3 working days after receipt.", CELLUMOVE_SHIPPING_URL),
      offer(product.id, "delivery_time", "Delivery is stated as 3 to 14 working days after dispatch, subject to location and peak-period variation.", CELLUMOVE_SHIPPING_URL),
      offer(product.id, "tracking", "A tracking number is sent by email after dispatch and can also be checked through Track My Order.", CELLUMOVE_SHIPPING_URL),
      offer(product.id, "customs_and_local_fees", "Customs duties, taxes, VAT, and local courier handling fees are the customer's responsibility and are not reimbursed by Cellumove.", CELLUMOVE_SHIPPING_URL),
      offer(product.id, "return_request_window", "The refund policy allows a replacement or exchange request within 30 days after the product is received.", CELLUMOVE_REFUND_URL),
      offer(product.id, "return_condition", "Returned products must be unworn, unwashed, in original condition, with original packaging, intact tags, and proof of purchase.", CELLUMOVE_REFUND_URL),
      offer(product.id, "return_shipping", "The customer pays the return shipping cost and should use a tracked shipping method.", CELLUMOVE_REFUND_URL),
      offer(product.id, "restocking_fee", "A €30 restocking fee may apply and may be deducted from the refund.", CELLUMOVE_REFUND_URL),
      offer(product.id, "non_returnable_items", "Sale, discount-code, clearance, hygiene, and intimate items are listed as non-returnable or non-refundable.", CELLUMOVE_REFUND_URL),
      offer(product.id, "refund_processing_time", "After an accepted return is received and inspected, an approved refund is processed within 14 working days.", CELLUMOVE_REFUND_URL),
      offer(product.id, "cancellation", "Cancellation may be requested before dispatch; after dispatch, the customer must wait for delivery and follow the return process.", CELLUMOVE_REFUND_URL),
      offer(product.id, "damaged_item_resolution", "For a validated defective or damaged item, Cellumove's refund policy states that a replacement may be issued.", CELLUMOVE_REFUND_URL),
      offer(product.id, "wrong_item_resolution", "For a validated incorrect item, Cellumove states that the correct product will be sent free of charge.", CELLUMOVE_REFUND_URL),
      offer(product.id, "lost_parcel_resolution", "If a parcel marked delivered is confirmed lost after carrier investigation, Cellumove states that it will issue a full replacement.", CELLUMOVE_REFUND_URL),
      offer(product.id, "statutory_withdrawal_window", "The terms of sale state a 14-day right of withdrawal from receipt of the product.", CELLUMOVE_TERMS_URL),
      offer(product.id, "ninety_day_guarantee_claim_review", "The site banner advertises a 90-day money-back guarantee, but the formal refund policy does not define this guarantee.", CELLUMOVE_HOMEPAGE_URL, "draft"),
      offer(product.id, "thirty_day_guarantee_claim_review", "The homepage body also advertises a 30-day guarantee, creating a conflict with the site's 90-day banner.", CELLUMOVE_HOMEPAGE_URL, "draft"),
      offer(product.id, "free_size_exchange_claim_review", "The homepage advertises a free size exchange, while the refund policy says return shipping is paid by the customer and a restocking fee may apply.", CELLUMOVE_HOMEPAGE_URL, "draft"),
    );
  }

  return { facts, offers };
}
