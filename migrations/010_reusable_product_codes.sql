-- Product codes are user-assigned naming/grouping labels, not product identities.
-- Multiple copied Shopify products may intentionally share the same code.
-- Product.id remains the unique relational key throughout AdFactory.

drop index if exists product_code_key;

create index if not exists product_code_lookup_idx
  on "Product" (upper(code))
  where code is not null and btrim(code) <> '';
