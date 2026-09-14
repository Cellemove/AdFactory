// INGEST — pure half. Turns a normalized BrandSearch ad into the "CompetitorAd"
// row shape. Shared by the /spy import action and the corpus CLI so both write
// identical rows (the unique key is provider + platform + externalId).

import type { NormalizedBrandSearchAd } from "@/lib/brandsearch";
import type { Json } from "@/lib/database.types";
import { competitorAdId } from "./ids";

export { competitorAdId };

export type CompetitorAdUpsertRow = {
  id: string;
  provider: string;
  externalId: string;
  platform: string;
  brandId: string | null;
  brandName: string;
  sourceUrl: string;
  dashboardUrl: string | null;
  mediaType: "image" | "video";
  imageUrl: string | null;
  videoUrl: string | null;
  copy: string;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  transcriptUrl: string | null;
  winnerEvidence: string;
  evidenceReasons: Json;
  metrics: Json;
  rawPayload: Json;
  mediaExpiresAt: string;
  lastSeenAt: string;
  fetchedAt: string;
  updatedAt: string;
};

export function toCompetitorAdRow(
  ad: NormalizedBrandSearchAd,
  fetchedAt: string,
  mediaExpiresAt: string,
): CompetitorAdUpsertRow {
  const platform = ad.platform.toLowerCase();
  return {
    id: competitorAdId(ad.provider, platform, ad.externalId),
    provider: ad.provider,
    externalId: ad.externalId,
    platform,
    brandId: ad.brandId,
    brandName: ad.brandName,
    sourceUrl: ad.sourceUrl,
    dashboardUrl: ad.dashboardUrl,
    mediaType: ad.mediaType,
    imageUrl: ad.imageUrl || null,
    videoUrl: ad.videoUrl,
    copy: ad.copy,
    status: ad.status,
    startedAt: ad.startedAt,
    endedAt: ad.endedAt,
    durationSec: ad.durationSec,
    transcriptUrl: ad.transcriptUrl,
    winnerEvidence: ad.winnerEvidence,
    evidenceReasons: ad.evidenceReasons as Json,
    metrics: ad.metrics as Json,
    rawPayload: ad.rawPayload as Json,
    mediaExpiresAt,
    lastSeenAt: fetchedAt,
    fetchedAt,
    updatedAt: fetchedAt,
  };
}
