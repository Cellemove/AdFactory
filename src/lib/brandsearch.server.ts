import "server-only";

import {
  BrandSearchDiscoverResponseSchema,
  brandSearchNicheForSpy,
  normalizeBrandSearchMetaAd,
  type NormalizedBrandSearchAd,
} from "@/lib/brandsearch";

const API_BASE = "https://api.brandsearch.co";
const META_FIELDS = [
  "id", "ad_id", "brand_id", "status", "start_date", "end_date", "total_active_time", "created_at",
  "creative", "page_info", "is_video", "is_image", "is_duplicate", "duplicate_count", "duration",
  "has_transcript", "transcript_url", "video_sd_url", "video_hd_url", "thumbnail_url", "image_url",
  "image_original_url", "platforms", "eu_total_spend", "eu_daily_spend", "eu_total_reach", "funnel_type",
  "language", "reach_rank", "dashboard_url",
].join(",");

export type BrandSearchImportResult = {
  ads: NormalizedBrandSearchAd[];
  seed: string;
  creditsUsed: number | null;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
};

export function isBrandSearchConfigured(): boolean {
  return Boolean(process.env.BRANDSEARCH_API_KEY?.trim());
}

function apiKey(): string {
  const value = process.env.BRANDSEARCH_API_KEY?.trim();
  if (!value) throw new Error("BRANDSEARCH_API_KEY is not configured on the server.");
  return value;
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown; code?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
    if (typeof error?.code === "string") return error.code;
  }
  return `BrandSearch request failed (${status}).`;
}

export async function testBrandSearchConnection(): Promise<{
  ok: true;
  accountLabel: string;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
}> {
  const response = await fetch(`${API_BASE}/v1/me`, {
    headers: { "X-API-Key": apiKey(), Accept: "application/json" },
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const accountLabel = [record.email, record.name, record.user_id]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) || "connected account";
  return {
    ok: true,
    accountLabel,
    dailyRemaining: headerNumber(response.headers, "X-Quota-Daily-Remaining"),
    monthlyRemaining: headerNumber(response.headers, "X-Quota-Monthly-Remaining"),
  };
}

export async function discoverBrandSearchMetaAds(input: {
  nicheSlug: string;
  focus?: string | null;
  limit?: number;
  now?: Date;
}): Promise<BrandSearchImportResult> {
  const now = input.now ?? new Date();
  const seed = `adfactory-${now.toISOString().slice(0, 10)}-${input.nicheSlug}`.slice(0, 64);
  const params = new URLSearchParams({
    niche: brandSearchNicheForSpy(input.nicheSlug),
    languages: "en",
    limit: String(Math.min(50, Math.max(1, input.limit ?? 24))),
    max_ads_per_brand: "3",
    seed,
    fields: META_FIELDS,
  });
  const focus = input.focus?.trim();
  if (focus) params.set("q", focus.slice(0, 200));

  const response = await fetch(`${API_BASE}/v1/meta-ads/discover?${params}`, {
    headers: { "X-API-Key": apiKey(), Accept: "application/json" },
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  const parsed = BrandSearchDiscoverResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("BrandSearch returned an unexpected Meta ads response.");

  return {
    ads: parsed.data.data.map(normalizeBrandSearchMetaAd),
    seed: parsed.data.seed || seed,
    creditsUsed: headerNumber(response.headers, "X-Credits-Used"),
    dailyRemaining: headerNumber(response.headers, "X-Quota-Daily-Remaining"),
    monthlyRemaining: headerNumber(response.headers, "X-Quota-Monthly-Remaining"),
  };
}

