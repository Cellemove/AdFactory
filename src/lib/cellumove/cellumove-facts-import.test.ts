import assert from "node:assert/strict";
import test from "node:test";
import { buildCellumoveFactsAndOffers } from "./cellumove-facts-import";

const product = {
  id: "product-1",
  name: "3D Leggings",
  metadata: {
    storeDomain: "example.myshopify.com",
    productId: "gid://shopify/Product/1",
    title: "3D Leggings",
    description: "A compression knit.",
    featuredImageUrl: null,
    handle: "3d-leggings",
    status: "active",
    vendor: "Cellumove",
    productType: "Leggings",
    onlineStoreUrl: "https://cellumove.com/products/3d-leggings",
    updatedAt: "2026-09-11T00:00:00Z",
    syncedAt: "2026-09-11T00:00:00Z",
    options: [
      { name: "Color", values: ["Black", "Pink"] },
      { name: "Size", values: ["S", "M"] },
    ],
    variants: [{
      id: "variant-1",
      title: "Black / S",
      sku: null,
      barcode: null,
      availableForSale: true,
      price: "49.90",
      compareAtPrice: "69.90",
      selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }],
      imageUrl: null,
    }],
    images: [],
    variantsTruncated: false,
  },
};

test("builds approved catalog facts and keeps unsupported outcome claims in draft", () => {
  const result = buildCellumoveFactsAndOffers([product]);
  assert.equal(result.facts.find((row) => row.factType === "available_colors")?.status, "approved");
  assert.equal(result.facts.find((row) => row.factType === "first_wear_outcome_claim_review")?.status, "draft");
  assert.equal(result.offers.find((row) => row.offerType === "current_uk_catalog_price")?.marketCode, "UK");
  assert.match(result.offers.find((row) => row.offerType === "current_uk_catalog_price")?.statement ?? "", /£49\.90, compared with £69\.90/);
});

test("records the conflicting guarantee language as review-only offers", () => {
  const result = buildCellumoveFactsAndOffers([product]);
  assert.equal(result.offers.find((row) => row.offerType === "ninety_day_guarantee_claim_review")?.status, "draft");
  assert.equal(result.offers.find((row) => row.offerType === "thirty_day_guarantee_claim_review")?.status, "draft");
  assert.equal(result.offers.find((row) => row.offerType === "return_request_window")?.status, "approved");
  assert.equal(result.offers.find((row) => row.offerType === "statutory_withdrawal_window")?.status, "approved");
});

test("uses stable IDs so repeated imports are idempotent", () => {
  const first = buildCellumoveFactsAndOffers([product]);
  const second = buildCellumoveFactsAndOffers([product]);
  assert.deepEqual(first.facts.map((row) => row.id), second.facts.map((row) => row.id));
  assert.deepEqual(first.offers.map((row) => row.id), second.offers.map((row) => row.id));
});
