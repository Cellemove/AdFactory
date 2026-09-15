import assert from "node:assert/strict";
import test from "node:test";
import { renderMarketProfileBlock } from "./market-profiles";
import { filterSopsForMarket } from "./agents";
import type { MarketProfileRow } from "@/lib/database.types";

const row: MarketProfileRow = {
  id: "m1",
  code: "pt",
  name: "Portugal",
  tone: "warm, direct, family-forward",
  vocabulary: JSON.stringify({ favor: ["leveza"], avoid: ["clinical jargon"] }),
  hooksThatWork: JSON.stringify(["family testimonial"]),
  hooksThatFlop: JSON.stringify(["cold statistics"]),
  allowedClaims: JSON.stringify(["90 days risk-free"]),
  forbiddenClaims: JSON.stringify(["cures"]),
  disclaimerClaims: null,
  trustpilotScore: null,
  culturalNotes: "Sunday family lunch matters.",
  order: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as MarketProfileRow;

test("renderMarketProfileBlock parses JSON columns and survives malformed ones", () => {
  const block = renderMarketProfileBlock(row);
  assert.ok(block);
  assert.equal(block.tone, row.tone);
  assert.deepEqual(block.vocabulary, { favor: ["leveza"], avoid: ["clinical jargon"] });
  assert.deepEqual(block.claims.forbidden, ["cures"]);
  assert.deepEqual(block.claims.disclaimers, []);

  const broken = renderMarketProfileBlock({ ...row, vocabulary: "{not json", hooksThatWork: "also broken" });
  assert.ok(broken);
  assert.deepEqual(broken.vocabulary, { favor: [], avoid: [] });
  assert.deepEqual(broken.hooksThatWork, []);

  assert.equal(renderMarketProfileBlock(null), null);
});

test("filterSopsForMarket is case-insensitive and keeps global SOPs", () => {
  const rows = [
    { marketScope: null, slug: "global" },
    { marketScope: "pt", slug: "pt-tone" },
    { marketScope: "de", slug: "de-tone" },
  ];
  // The brief upper-cases market codes; SOP scopes are lowercase — the exact
  // mismatch that silently dropped market tone before.
  assert.deepEqual(filterSopsForMarket(rows, "PT").map((r) => r.slug), ["global", "pt-tone"]);
  assert.deepEqual(filterSopsForMarket(rows, null).map((r) => r.slug), ["global"]);
  assert.deepEqual(filterSopsForMarket(rows, "  De ").map((r) => r.slug), ["global", "de-tone"]);
});
