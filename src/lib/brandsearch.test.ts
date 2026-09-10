import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMetaEvidence,
  competitorAliases,
  isFeedStale,
  isOwnBrand,
  matchCompetitor,
  normalizeBrandSearchMetaAd,
  SpectreAdsResponseSchema,
  SpectreFolderDetailSchema,
  type SpectreCompetitor,
} from "./brandsearch";

test("Meta evidence stays a probable winner even with strong spend", () => {
  const evidence = classifyMetaEvidence({
    id: "ad-1",
    eu_total_spend: 12_500,
    eu_total_reach: 850_000,
    reach_rank: 3,
    total_active_time: 30 * 86_400,
  });
  assert.equal(evidence.label, "probable_winner");
  assert.ok(evidence.reasons.some((reason) => reason.includes("spend")));
  assert.ok(evidence.reasons.some((reason) => reason.includes("days active")));
});

test("Spectre ads without a threshold signal are only observed", () => {
  assert.equal(classifyMetaEvidence({ id: "ad-2", eu_total_spend: 40 }, "spectre").label, "observed");
  assert.equal(classifyMetaEvidence({ id: "ad-3", eu_total_spend: 815 }, "spectre").label, "probable_winner");
});

test("normalizer preserves exact provider id and builds a Meta Library source", () => {
  const ad = normalizeBrandSearchMetaAd({
    id: "provider-id",
    ad_id: "1472557257729515",
    brand_id: "example.com",
    page_info: { name: "Example" },
    creative: { title: "A real hook", description: "Supporting copy", cta: { text: "Shop now" } },
    is_video: true,
    image_url: "https://cdn.example/image.jpg",
    video_sd_url: "https://cdn.example/video.mp4",
    has_transcript: true,
    transcript_url: "https://cdn.example/transcript.json",
  });
  assert.equal(ad.externalId, "provider-id");
  assert.equal(ad.sourceUrl, "https://www.facebook.com/ads/library/?id=1472557257729515");
  assert.equal(ad.brandName, "Example");
  assert.equal(ad.copy, "A real hook — Supporting copy — Shop now");
  assert.equal(ad.mediaType, "video");
  assert.equal(ad.transcriptUrl, "https://cdn.example/transcript.json");
});

test("Spectre ads are labelled by the tracked brand, not the Facebook page", () => {
  const parsed = SpectreAdsResponseSchema.parse({
    data: [{
      id: "1877097136551308",
      ad_id: "1877097136551308",
      brand_id: "onecompress.com",
      page_info: { id: "101568062195983", name: "Pure Living Digest" },
      eu_total_spend: 815.21,
      _swipe: { tracked_brand_id: "cmt1", brand_id: "onecompress.com", page_id: null },
    }],
    pagination: { page: 1, page_size: 1, total: 16147, total_pages: 16147 },
  });
  const ad = normalizeBrandSearchMetaAd(parsed.data[0]!, "spectre");
  assert.equal(ad.brandDomain, "onecompress.com");
  assert.equal(ad.brandName, "onecompress.com");
  assert.equal(ad.winnerEvidence, "probable_winner");
});

test("Spectre schemas reject malformed rows", () => {
  assert.equal(SpectreAdsResponseSchema.safeParse({ data: [{ brand_id: "missing-id" }] }).success, false);
  assert.equal(SpectreFolderDetailSchema.safeParse({ id: "f1" }).success, false);
});

const COMPETITORS: SpectreCompetitor[] = [
  "se.gymshark.com",
  "getionix.com",
  "drinkag1.com",
  "try-herbloom.fr",
  "celsior-italia.com",
  "leonieandco.co.uk",
  "cean.com",
  "thighsociety.com",
].map((domain) => ({ domain, name: domain }));

test("competitor aliases strip country subdomains, TLDs and common prefixes", () => {
  assert.deepEqual(competitorAliases("se.gymshark.com"), ["gymshark"]);
  assert.ok(competitorAliases("getionix.com").includes("ionix"));
  assert.ok(competitorAliases("drinkag1.com").includes("ag1"));
  assert.ok(competitorAliases("leonieandco.co.uk").includes("leonieco"));
});

test("creatives match their tracked competitor by name, link or domain", () => {
  const cases: [string, string][] = [
    ["Gymshark", "se.gymshark.com"],
    ["Ionix Labs", "getionix.com"],
    ["AG1", "drinkag1.com"],
    ["Herbloom", "try-herbloom.fr"],
    ["Celsior", "celsior-italia.com"],
    ["Leonie & Co", "leonieandco.co.uk"],
    ["Thigh Society", "thighsociety.com"],
  ];
  for (const [brand, domain] of cases) {
    assert.equal(matchCompetitor({ brand, sourceUrl: "https://www.facebook.com/ads/library/?id=1" }, COMPETITORS), domain, brand);
  }
  assert.equal(matchCompetitor({ brand: "Shop", sourceUrl: "https://gymshark.com/products/x" }, COMPETITORS), "se.gymshark.com");
  assert.equal(matchCompetitor({ brand: "Pure Living Digest", brandDomain: "getionix.com" }, COMPETITORS), "getionix.com");
});

test("untracked brands are rejected", () => {
  assert.equal(matchCompetitor({ brand: "Ocean Co", sourceUrl: "https://www.tiktok.com/@oceanco" }, COMPETITORS), null);
  assert.equal(matchCompetitor({ brand: "Spanx", sourceUrl: "https://www.facebook.com/ads/library/?id=2" }, COMPETITORS), null);
  assert.equal(matchCompetitor({ brand: "Spanx", brandDomain: "spanx.com" }, COMPETITORS), null);
});

test("a cached feed goes stale an hour before its 3-day media links expire", () => {
  const fetchedAt = "2026-09-10T07:00:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  assert.equal(isFeedStale(fetchedAt, at("2026-09-12T07:00:00.000Z")), false);
  assert.equal(isFeedStale(fetchedAt, at("2026-09-13T05:59:00.000Z")), false);
  assert.equal(isFeedStale(fetchedAt, at("2026-09-13T06:00:00.000Z")), true);
  assert.equal(isFeedStale("not a date", at("2026-09-10T08:00:00.000Z")), true);
});

test("CelluMove's own store counts as own brand", () => {
  assert.equal(isOwnBrand("cellumovefitwear.com"), true);
  assert.equal(isOwnBrand("onecompress.com"), false);
});
