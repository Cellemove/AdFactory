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
export const CELLUMOVE_BUY_ONE_TAKE_ONE_URL = "https://cellumove.com/pages/lymphatic-drainage";
export const CELLUMOVE_FIFTY_PERCENT_OFF_URL = "https://cellumove.com/pages/mofu-period-bloating";

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

function productSourceUrl(metadata: ShopifyProductMetadata): string {
  if (metadata.onlineStoreUrl) return metadata.onlineStoreUrl;
  const storeHandle = metadata.storeDomain.replace(/\.myshopify\.com$/i, "");
  const numericProductId = metadata.productId.split("/").at(-1);
  return `https://admin.shopify.com/store/${storeHandle}/products/${numericProductId}`;
}

function currencyAmount(value: string, currencyCode: string): string {
  const symbols: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", AUD: "A$", CAD: "C$" };
  return `${symbols[currencyCode] ?? `${currencyCode} `}${value}`;
}

function marketForCurrency(currencyCode: string): string | null {
  return ({ GBP: "UK", AUD: "AU", CAD: "CA", CZK: "CZ", PLN: "PL", SEK: "SE" } as Record<string, string>)[currencyCode] ?? null;
}

function buildPriceOffers(product: CellumoveImportProduct, currencyCode: string): CellumoveOfferSeed[] {
  const { metadata } = product;
  const title = metadata.title?.trim() || product.name;
  const sourceUrl = productSourceUrl(metadata);
  const marketCode = marketForCurrency(currencyCode);
  const prices = [...new Set(metadata.variants.map((variant) => variant.price).filter(Boolean))];
  const compareAtPrices = [...new Set(metadata.variants.map((variant) => variant.compareAtPrice).filter((value): value is string => Boolean(value)))];
  if (!prices.length) return [];

  if (prices.length === 1) {
    const compareAt = compareAtPrices.length === 1 ? `, compared with ${currencyAmount(compareAtPrices[0]!, currencyCode)}` : "";
    return [offer(
      product.id,
      "current_catalog_price",
      `The current ${currencyCode} Shopify catalog price is ${currencyAmount(prices[0]!, currencyCode)}${compareAt} for the listed variants of ${title}.`,
      sourceUrl,
      "approved",
      marketCode,
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
      `current_catalog_price_${normalizeStatement(style).replaceAll(" ", "_")}`,
      `The current ${currencyCode} Shopify catalog price is ${currencyAmount(stylePrices[0]!, currencyCode)} for ${style} variants of ${title}.`,
      sourceUrl,
      "approved",
      marketCode,
    )];
  });
  if (byStyle.length) return byStyle;

  return [offer(
    product.id,
    "current_catalog_price_range",
    `Current ${currencyCode} Shopify catalog prices for ${title} range from ${currencyAmount(prices.sort((a, b) => Number(a) - Number(b))[0]!, currencyCode)} to ${currencyAmount(prices.at(-1)!, currencyCode)} depending on the selected variant.`,
    sourceUrl,
    "approved",
    marketCode,
  )];
}

export function buildCellumoveFactsAndOffers(products: CellumoveImportProduct[], currencyCode = "GBP"): {
  facts: CellumoveFactSeed[];
  offers: CellumoveOfferSeed[];
} {
  const facts: CellumoveFactSeed[] = [];
  const offers: CellumoveOfferSeed[] = [];

  for (const product of products) {
    const sourceUrl = productSourceUrl(product.metadata);
    const title = product.metadata.title?.trim() || product.name;
    const description = product.metadata.description?.trim() || "";
    const colors = option(product.metadata, /^colou?r$/i);
    const sizes = option(product.metadata, /^size$/i);
    const styles = option(product.metadata, /^style$/i);

    facts.push(
      fact(product.id, "official_catalog_name", `The official Shopify catalog name is “${title}”.`, sourceUrl),
      fact(product.id, "shopify_catalog_status", `The Shopify product status is ${product.metadata.status}.`, sourceUrl),
      fact(product.id, "shopify_vendor", `The Shopify catalog vendor is ${product.metadata.vendor || "Cellumove"}.`, sourceUrl),
      fact(product.id, "listed_variant_count", `The Shopify catalog contains ${product.metadata.variants.length} listed variants for this product.`, sourceUrl),
    );
    if (product.metadata.productType) facts.push(fact(product.id, "shopify_product_type", `The Shopify product type is ${product.metadata.productType}.`, sourceUrl));
    if (description) {
      const requiresClaimReview = /\b(?:clinically|medical|doctor|pain|swelling|circulation|lymph|lipedema|lipoedema|lymphedema|varicose|calorie|weight loss|burn|results? in|days?|weeks?|cure|treat|prevent|relief)\b/i.test(description);
      facts.push(fact(product.id, requiresClaimReview ? "catalog_description_claim_review" : "official_catalog_description", description, sourceUrl, requiresClaimReview ? "draft" : "approved"));
    }
    for (const productOption of product.metadata.options) {
      if (!productOption.values.length) continue;
      const rawOptionKey = normalizeStatement(productOption.name).replaceAll(" ", "_").slice(0, 48) || "option";
      const optionKey = ({ color: "colors", colour: "colors", size: "sizes", style: "styles" } as Record<string, string>)[rawOptionKey] ?? rawOptionKey;
      facts.push(fact(product.id, `available_${optionKey}`, `Listed ${productOption.name.toLowerCase()} options: ${productOption.values.join(", ")}.`, sourceUrl));
    }
    if (colors.length && sizes.length) {
      facts.push(fact(product.id, "available_color_and_size_summary", `This product is available in ${colors.length} listed colors and sizes ranging from ${sizes[0]} through ${sizes.at(-1)}.`, sourceUrl));
    }
    if (styles.length) facts.push(fact(product.id, "available_style_summary", `This product has ${styles.join(" and ")} style options.`, sourceUrl));

    const looksLikeCompressionLegging = /legging|compression/i.test(`${product.name} ${title} ${description}`);
    if (looksLikeCompressionLegging) {
      facts.push(
        fact(product.id, "texture_design", "The raised honeycomb 3D™ texture is designed to stay in contact with the legs throughout the day.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "movement_mechanism", "As the wearer moves, the raised texture is designed to press gently against the skin and create a continuous hands-free micro-massage.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "compression_profile", "The compression is described as firmest at the ankle and progressively lighter higher up the leg.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "brand_product_design", "Cellumove describes its 3D™ technology as combining textured fabric, targeted compression, and sculpting support.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "everyday_wear_design", "Cellumove describes its pieces as made to move with the wearer during workouts, errands, and everyday life while providing support throughout the day.", CELLUMOVE_HOMEPAGE_URL),
        fact(product.id, "customer_support_contact", "Customer support is available at contact@cellumove.com, and the contact page states that replies are provided within 72 hours.", CELLUMOVE_CONTACT_URL),
        fact(product.id, "first_wear_outcome_claim_review", "Cellumove claims smoother, firmer, lighter legs from the first wear.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "cellulite_outcome_claim_review", "Cellumove claims the product is designed to smooth the look of cellulite with every week of movement.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "daily_outcome_claim_review", "Cellumove claims the first result a wearer feels is lighter legs by evening, with smoother-looking results building over time.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "social_proof_claim_review", "The homepage claims the products are loved by more than 100,000 women.", CELLUMOVE_HOMEPAGE_URL, "draft"),
        fact(product.id, "squat_proof_claim_review", "The homepage describes the 3D™ knit as squat-proof.", CELLUMOVE_HOMEPAGE_URL, "draft"),
      );
      offers.push(
        offer(
          product.id,
          "buy_one_take_one",
          "Buy 1 Take 1 — buy one pair and receive a second pair free.",
          CELLUMOVE_BUY_ONE_TAKE_ONE_URL,
        ),
        offer(
          product.id,
          "fifty_percent_off",
          "50% Off — receive 50% off the advertised Cellumove product offer.",
          CELLUMOVE_FIFTY_PERCENT_OFF_URL,
        ),
      );
    }

    facts.push(
      fact(product.id, "manufacturing_location", "Cellumove's terms state that its products are manufactured by a partner factory in Asia.", CELLUMOVE_TERMS_URL),
      fact(product.id, "factory_standards_claim_review", "Cellumove claims its partner factory follows strict hygiene and fair working-condition standards.", CELLUMOVE_TERMS_URL, "draft"),
    );

    offers.push(
      ...buildPriceOffers(product, currencyCode),
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
