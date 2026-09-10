import { z } from "zod";

export const BRANDSEARCH_PROVIDER = "brandsearch" as const;
export const BRANDSEARCH_MEDIA_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Refresh a little before the media links actually die, so previews don't
// break mid-session.
const FEED_STALE_MARGIN_MS = 60 * 60 * 1000;

/** True once a cached feed's BrandSearch image/video links are (about to be) expired. */
export function isFeedStale(fetchedAt: string, now: number = Date.now()): boolean {
  const fetched = Date.parse(fetchedAt);
  return !Number.isFinite(fetched) || fetched + BRANDSEARCH_MEDIA_TTL_MS - FEED_STALE_MARGIN_MS <= now;
}

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

// Spectre-folder ad rows carry which tracked brand they were pulled for.
const SwipeBlockSchema = z.object({
  tracked_brand_id: z.string().nullish(),
  brand_id: z.string().nullish(),
  page_id: z.union([z.string(), z.number()]).nullish(),
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
  _swipe: SwipeBlockSchema.nullish(),
}).passthrough();

const PaginationSchema = z.object({
  page: z.number(),
  page_size: z.number(),
  total: z.number().nullish(),
  total_pages: z.number().nullish(),
}).passthrough();

export const SpectreFolderListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string().nullish(),
    item_count: z.number().nullish(),
  }).passthrough()),
  pagination: PaginationSchema.nullish(),
});

export const SpectreFolderDetailSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  items: z.array(z.object({
    tracked_brand_id: z.string().nullish(),
    name: z.string().nullish(),
    brand_id: z.string().nullish(),
    page_id: z.union([z.string(), z.number()]).nullish(),
    url: z.string().nullish(),
  }).passthrough()),
});

export const SpectreAdsResponseSchema = z.object({
  data: z.array(BrandSearchMetaAdSchema),
  pagination: PaginationSchema.nullish(),
});

export type BrandSearchMetaAd = z.infer<typeof BrandSearchMetaAdSchema>;

/** Which BrandSearch pool an ad came from — changes how strongly it reads as a winner. */
export type BrandSearchCohort = "discover" | "spectre";

export type NormalizedBrandSearchAd = {
  provider: typeof BRANDSEARCH_PROVIDER;
  externalId: string;
  platform: "Meta";
  brandId: string | null;
  /** Tracked-brand domain from Spectre (`_swipe.brand_id`), else the ad's brand_id. */
  brandDomain: string | null;
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

export function classifyMetaEvidence(ad: BrandSearchMetaAd, cohort: BrandSearchCohort = "discover"): {
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

  // Spectre ads are everything a tracked competitor runs, not a pre-gated
  // cohort — without a threshold signal they are only observed.
  if (cohort === "spectre") {
    return reasons.length > 0 ? { label: "probable_winner", reasons } : { label: "observed", reasons };
  }

  // The BrandSearch Meta discover cohort itself is gated to top-10 reach rank
  // OR >€500 observed EU spend. Keep that provenance explicit if projection or
  // regional coverage omitted the qualifying metric from this row.
  if (reasons.length === 0) reasons.push("selected by BrandSearch's Meta scaling cohort");
  return { label: "probable_winner", reasons };
}

export function normalizeBrandSearchMetaAd(
  ad: BrandSearchMetaAd,
  cohort: BrandSearchCohort = "discover",
): NormalizedBrandSearchAd {
  const externalId = String(ad.id);
  const metaLibraryId = ad.ad_id == null ? null : String(ad.ad_id);
  const dashboardUrl = ad.dashboard_url?.trim() || null;
  const sourceUrl = metaLibraryId
    ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(metaLibraryId)}`
    : dashboardUrl || `https://app.brandsearch.co/ads/meta/${encodeURIComponent(externalId)}`;
  const evidence = classifyMetaEvidence(ad, cohort);
  const brandDomain = ad._swipe?.brand_id?.trim() || ad.brand_id?.trim() || null;
  const pageName = ad.page_info?.name?.trim() || null;

  return {
    provider: BRANDSEARCH_PROVIDER,
    externalId,
    platform: "Meta",
    brandId: ad.brand_id?.trim() || null,
    brandDomain,
    // Competitors often advertise through differently named pages (e.g.
    // onecompress.com runs as "Pure Living Digest"), so a Spectre ad is labelled
    // by the tracked brand the user recognises.
    brandName: (cohort === "spectre" ? brandDomain : null) || pageName || brandDomain || "Unknown advertiser",
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

// ─── Spectre competitors ─────────────────────────────────────────────────────
// The spy page only shows brands tracked in BrandSearch Spectre. Spectre keys
// each brand by its store domain, so matching a creative back to a competitor
// goes by the tracked domain when we have it, else the ad's link host or name.

export type SpectreCompetitor = {
  /** Tracked store domain as stored in Spectre, e.g. "se.gymshark.com". */
  domain: string;
  name: string;
};

// Second-level labels that sit before a country TLD (leonieandco.co.uk).
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "ac"]);
const BRAND_PREFIXES = /^(try|get|drink|shop|my|the)(?=[a-z0-9]{3,})/;

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Lowercased host without protocol, path or `www.`. */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
}

/** The brand label of a domain: "se.gymshark.com" → "gymshark". */
function domainRoot(domain: string): string {
  const labels = normalizeDomain(domain).split(".").filter(Boolean);
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels.at(-1) ?? "")) labels.pop();
  return labels.at(-1) ?? "";
}

/** Compact name variants a creative's brand may appear under. */
export function competitorAliases(domain: string): string[] {
  const root = compact(domainRoot(domain));
  const aliases = new Set([root]);
  const unprefixed = root.replace(BRAND_PREFIXES, "");
  aliases.add(unprefixed);
  for (const alias of [...aliases]) aliases.add(alias.replace(/and/g, ""));
  return [...aliases].filter((alias) => alias.length >= 2);
}

export function isOwnBrand(domain: string): boolean {
  return compact(domainRoot(domain)).includes("cellumove");
}

function hostOfUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * The Spectre competitor a creative belongs to, or null if it's another brand.
 * Name matching is equality or prefix (min 4 chars) — never a bare substring,
 * so "Ocean Co" doesn't match cean.com.
 */
export function matchCompetitor(
  ad: { brand?: string | null; sourceUrl?: string | null; brandDomain?: string | null },
  competitors: SpectreCompetitor[],
): string | null {
  if (ad.brandDomain) {
    const wanted = normalizeDomain(ad.brandDomain);
    const hit = competitors.find((c) => normalizeDomain(c.domain) === wanted);
    if (hit) return hit.domain;
  }

  const host = hostOfUrl(ad.sourceUrl ?? undefined);
  if (host) {
    const hostRoot = domainRoot(host);
    const hit = competitors.find((c) => {
      const domain = normalizeDomain(c.domain);
      return host === domain || host.endsWith(`.${domain}`) || (hostRoot.length >= 4 && hostRoot === domainRoot(domain));
    });
    if (hit) return hit.domain;
  }

  const brand = compact(ad.brand ?? "");
  if (brand.length < 2) return null;
  const variants = [brand, brand.replace(/and/g, "")];
  for (const competitor of competitors) {
    for (const alias of competitorAliases(competitor.domain)) {
      for (const variant of variants) {
        if (variant === alias) return competitor.domain;
        if (Math.min(variant.length, alias.length) >= 4 && (variant.startsWith(alias) || alias.startsWith(variant))) {
          return competitor.domain;
        }
      }
    }
  }
  return null;
}

