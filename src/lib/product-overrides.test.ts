import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdFactoryProductOverrides,
  readAdFactoryProductOverrides,
  resolveProductFields,
  writeAdFactoryProductOverrides,
} from "./product-overrides";

const source = {
  title: "Shopify title",
  description: "Shopify description",
  featuredImageUrl: "https://cdn.example.com/shopify.jpg",
};

test("stores only fields that differ from Shopify", () => {
  const overrides = buildAdFactoryProductOverrides(
    { name: "AdFactory title", description: source.description, imagePath: null },
    source,
    "2026-08-29T10:00:00.000Z",
  );
  assert.deepEqual(overrides, {
    name: "AdFactory title",
    imagePath: null,
    updatedAt: "2026-08-29T10:00:00.000Z",
  });
});

test("local overrides survive a Shopify refresh, including intentional null values", () => {
  const overrides = {
    name: "Local title",
    description: null,
    imagePath: null,
    updatedAt: "2026-08-29T10:00:00.000Z",
  };
  assert.deepEqual(resolveProductFields(source, overrides), {
    name: "Local title",
    description: null,
    imagePath: null,
  });
});

test("writing and clearing overrides preserves unrelated Shopify context", () => {
  const context = { shopify: { productId: "gid://shopify/Product/1" }, note: "keep me" };
  const written = writeAdFactoryProductOverrides(context, {
    name: "Local title",
    updatedAt: "2026-08-29T10:00:00.000Z",
  });
  assert.equal(readAdFactoryProductOverrides(written)?.name, "Local title");
  const cleared = writeAdFactoryProductOverrides(written, null) as Record<string, unknown>;
  assert.equal(cleared.note, "keep me");
  assert.deepEqual(cleared.shopify, context.shopify);
  assert.equal("adFactoryOverrides" in cleared, false);
});
