import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBrandSearchMetaAd } from "@/lib/brandsearch";
import { competitorAdId, toCompetitorAdRow } from "./ingest";

test("the row shape matches what the /spy import wrote before the refactor", () => {
  const ad = normalizeBrandSearchMetaAd({
    id: 12345,
    ad_id: "777",
    brand_id: "onecompress.com",
    status: "active",
    start_date: "2026-08-01",
    is_video: true,
    video_sd_url: "https://media10.brandsearch.co/resize/sd",
    video_hd_url: "https://media10.brandsearch.co/resize/hd",
    thumbnail_url: "https://media10.brandsearch.co/thumb",
    creative: { title: "Heavy legs?", description: "Try these." },
    eu_total_spend: 900,
    total_active_time: 20 * 86_400,
    platforms: ["facebook", "instagram"],
    has_transcript: true,
    transcript_url: "https://api.brandsearch.co/t/1",
  }, "spectre");
  const row = toCompetitorAdRow(ad, "2026-09-10T07:23:44.030Z", "2026-09-13T07:23:44.030Z");
  assert.equal(row.id, competitorAdId("brandsearch", "meta", "12345"));
  assert.match(row.id, /^cad_[0-9a-f]{24}$/);
  assert.equal(row.platform, "meta");
  assert.equal(row.externalId, "12345");
  assert.equal(row.brandName, "onecompress.com");
  assert.equal(row.mediaType, "video");
  assert.equal(row.videoUrl, "https://media10.brandsearch.co/resize/hd");
  assert.equal(row.transcriptUrl, "https://api.brandsearch.co/t/1");
  assert.equal(row.sourceUrl, "https://www.facebook.com/ads/library/?id=777");
  assert.equal(row.winnerEvidence, "probable_winner");
  assert.equal(row.mediaExpiresAt, "2026-09-13T07:23:44.030Z");
  assert.equal(row.fetchedAt, "2026-09-10T07:23:44.030Z");
  assert.equal(row.lastSeenAt, row.fetchedAt);
  assert.equal(row.updatedAt, row.fetchedAt);
  assert.equal((row.rawPayload as { video_sd_url?: string }).video_sd_url, "https://media10.brandsearch.co/resize/sd");
});
