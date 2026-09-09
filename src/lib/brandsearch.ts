import { z } from "zod";

export const BRANDSEARCH_PROVIDER = "brandsearch" as const;
export const BRANDSEARCH_MEDIA_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export type WinnerEvidence = "observed" | "probable_winner" | "verified_winner";

const CreativeSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  cta: z.object({ text: z.string().nullish(), type: z.string().nullish() }).nullish(),
}).passthrough();

const PageInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
}).passthrough();

export const BrandSearchMetaAdSchema = z.object({
  id: z.union([z.string(), z.number()]),
  ad_id: z.union([z.string(), z.number()]).nullish(),
  brand_id: z.string().nullish(),
  status: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  total_active_time: z.number().nullish(),
  created_at: z.string().nullish(),
  creative: CreativeSchema.nullish(),
  page_info: PageInfoSchema.nullish(),
  is_video: z.boolean().nullish(),
  is_image: z.boolean().nullish(),
  is_duplicate: z.boolean().nullish(),
  duplicate_count: z.number().nullish(),
  duration: z.number().nullish(),
  has_transcript: z.boolean().nullish(),
  transcript_url: z.string().nullish(),
  video_sd_url: z.string().nullish(),
  video_hd_url: z.string().nullish(),
  thumbnail_url: z.string().nullish(),
  image_url: z.string().nullish(),
  image_original_url: z.string().nullish(),
  platforms: z.array(z.string()).nullish(),
  eu_total_spend: z.number().nullish(),
  eu_daily_spend: z.number().nullish(),
  eu_total_reach: z.number().nullish(),
  funnel_type: z.string().nullish(),
  language: z.string().nullish(),
  reach_rank: z.number().nullish(),
  dashboard_url: z.string().nullish(),
}).passthrough();

export const BrandSearchDiscoverResponseSchema = z.object({
  data: z.array(BrandSearchMetaAdSchema),
  seed: z.string().optional(),
  count: z.number().optional(),
});

export type BrandSearchMetaAd = z.infer<typeof BrandSearchMetaAdSchema>;

export type NormalizedBrandSearchAd = {
  provider: typeof BRANDSEARCH_PROVIDER;
  externalId: string;
  platform: "Meta";
  brandId: string | null;
  brandName: string;
  sourceUrl: string;
  dashboardUrl: string | null;
  mediaType: "image" | "video";
  imageUrl: string;
  videoUrl: string | null;
  copy: string;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  transcriptUrl: string | null;
  winnerEvidence: WinnerEvidence;
  evidenceReasons: string[];
  metrics: Record<string, string | number | boolean | null>;
  rawPayload: BrandSearchMetaAd;
};

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactCopy(ad: BrandSearchMetaAd): string {
  return [ad.creative?.title, ad.creative?.description, ad.creative?.cta?.text]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(" — ");
}

export function classifyMetaEvidence(ad: BrandSearchMetaAd): {
  label: WinnerEvidence;
  reasons: string[];
} {
  const reasons: string[] = [];
  const spend = finiteNumber(ad.eu_total_spend);
  const reach = finiteNumber(ad.eu_total_reach);
  const rank = finiteNumber(ad.reach_rank);
  const activeSeconds = finiteNumber(ad.total_active_time);
  const duplicates = finiteNumber(ad.duplicate_count);

  if (spend !== null && spend >= 500) reasons.push(`€${Math.round(spend).toLocaleString("en-US")} observed EU spend`);
  if (rank !== null && rank >= 1 && rank <= 10) reasons.push(`top-${rank} reach rank`);
  if (reach !== null && reach >= 100_000) reasons.push(`${Math.round(reach).toLocaleString("en-US")} observed EU reach`);
  if (activeSeconds !== null && activeSeconds >= 14 * 86_400) {
    reasons.push(`${Math.floor(activeSeconds / 86_400)} days active`);
  }
  if (duplicates !== null && duplicates >= 3) reasons.push(`${duplicates} duplicate variants detected`);

  // The BrandSearch Meta discover cohort itself is gated to top-10 reach rank
  // OR >€500 observed EU spend. Keep that provenance explicit if projection or
  // regional coverage omitted the qualifying metric from this row.
  if (reasons.length === 0) reasons.push("selected by BrandSearch's Meta scaling cohort");
  return { label: "probable_winner", reasons };
}

export function normalizeBrandSearchMetaAd(ad: BrandSearchMetaAd): NormalizedBrandSearchAd {
  const externalId = String(ad.id);
  const metaLibraryId = ad.ad_id == null ? null : String(ad.ad_id);
  const dashboardUrl = ad.dashboard_url?.trim() || null;
  const sourceUrl = metaLibraryId
    ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(metaLibraryId)}`
    : dashboardUrl || `https://app.brandsearch.co/ads/meta/${encodeURIComponent(externalId)}`;
  const evidence = classifyMetaEvidence(ad);

  return {
    provider: BRANDSEARCH_PROVIDER,
    externalId,
    platform: "Meta",
    brandId: ad.brand_id?.trim() || null,
    brandName: ad.page_info?.name?.trim() || ad.brand_id?.trim() || "Unknown advertiser",
    sourceUrl,
    dashboardUrl,
    mediaType: ad.is_video ? "video" : "image",
    imageUrl: ad.image_url?.trim() || ad.thumbnail_url?.trim() || "",
    videoUrl: ad.video_hd_url?.trim() || ad.video_sd_url?.trim() || null,
    copy: compactCopy(ad),
    status: ad.status?.trim() || null,
    startedAt: ad.start_date || null,
    endedAt: ad.end_date || null,
    durationSec: finiteNumber(ad.duration),
    transcriptUrl: ad.has_transcript ? ad.transcript_url?.trim() || null : null,
    winnerEvidence: evidence.label,
    evidenceReasons: evidence.reasons,
    metrics: {
      euTotalSpend: finiteNumber(ad.eu_total_spend),
      euDailySpend: finiteNumber(ad.eu_daily_spend),
      euTotalReach: finiteNumber(ad.eu_total_reach),
      reachRank: finiteNumber(ad.reach_rank),
      totalActiveTimeSec: finiteNumber(ad.total_active_time),
      duplicateCount: finiteNumber(ad.duplicate_count),
      funnelType: ad.funnel_type?.trim() || null,
      language: ad.language?.trim() || null,
      hasTranscript: Boolean(ad.has_transcript && ad.transcript_url),
    },
    rawPayload: ad,
  };
}

export function brandSearchNicheForSpy(nicheSlug: string): "Fashion" | "Health & Supplements" {
  return nicheSlug === "compression-socks" || nicheSlug === "support-sleeves"
    ? "Health & Supplements"
    : "Fashion";
}

