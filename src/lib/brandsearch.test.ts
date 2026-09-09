import assert from "node:assert/strict";
import test from "node:test";
import {
  BrandSearchDiscoverResponseSchema,
  brandSearchNicheForSpy,
  classifyMetaEvidence,
  normalizeBrandSearchMetaAd,
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

test("discover response rejects malformed rows", () => {
  assert.equal(BrandSearchDiscoverResponseSchema.safeParse({ data: [{ brand_id: "missing-id" }] }).success, false);
});

test("AdFactory niches map to explicit BrandSearch cohorts", () => {
  assert.equal(brandSearchNicheForSpy("compression-leggings"), "Fashion");
  assert.equal(brandSearchNicheForSpy("support-sleeves"), "Health & Supplements");
});

