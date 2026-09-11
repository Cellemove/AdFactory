import "server-only";

import {
  isOwnBrand,
  normalizeBrandSearchMetaAd,
  normalizeDomain,
  SpectreAdsResponseSchema,
  SpectreFolderDetailSchema,
  SpectreFolderListSchema,
  type NormalizedBrandSearchAd,
  type SpectreCompetitor,
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

async function getJson(pathAndQuery: string): Promise<{ payload: unknown; headers: Headers }> {
  const response = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { "X-API-Key": apiKey(), Accept: "application/json" },
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return { payload, headers: response.headers };
}

async function postJson(path: string, body: unknown): Promise<{ payload: unknown; headers: Headers }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "X-API-Key": apiKey(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return { payload, headers: response.headers };
}

export type BrandWinnersPage = BrandSearchImportResult & { total: number | null };

/**
 * One page of a brand's surviving video ads: still running although launched
 * on or before `startedOnOrBefore`, highest EU spend first. Brands switch
 * losing creatives off within days, so an ad still live weeks later is the
 * closest public signal to BrandSearch's "Winning creative" badge (which the
 * API does not expose). Costs 1 credit per returned row.
 */
export async function fetchBrandWinners(input: { domain: string; startedOnOrBefore: string; page: number; pageSize: number }): Promise<BrandWinnersPage> {
  const { payload, headers } = await postJson("/v1/meta-ads/query", {
    brand_ids: [input.domain],
    status: "active",
    is_video: true,
    ad_started_to: input.startedOnOrBefore,
    sort_by: "eu_total_spend",
    sort_order: "desc",
    fields: META_FIELDS,
    page: input.page,
    page_size: Math.min(100, Math.max(1, input.pageSize)),
  });
  const parsed = SpectreAdsResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("BrandSearch returned an unexpected Meta ads response.");
  // Label by the tracked domain we asked for, the same way Spectre rows are.
  const ads = parsed.data.data.map((row) => normalizeBrandSearchMetaAd({ ...row, _swipe: { ...row._swipe, brand_id: input.domain } }, "spectre"));
  return {
    ads,
    total: parsed.data.pagination?.total ?? null,
    creditsUsed: headerNumber(headers, "X-Credits-Used"),
    dailyRemaining: headerNumber(headers, "X-Quota-Daily-Remaining"),
    monthlyRemaining: headerNumber(headers, "X-Quota-Monthly-Remaining"),
  };
}

type SpectreFolder = { id: string; itemCount: number };

// Folder listing and folder details are unmetered (0 credits).
async function listSpectreFolders(): Promise<SpectreFolder[]> {
  const folders: SpectreFolder[] = [];
  for (let page = 1; page <= 20; page++) {
    const { payload } = await getJson(`/v1/swipe/spectre-folders?page=${page}&page_size=100`);
    const parsed = SpectreFolderListSchema.safeParse(payload);
    if (!parsed.success) throw new Error("BrandSearch returned an unexpected Spectre folder list.");
    folders.push(...parsed.data.data.map((folder) => ({ id: folder.id, itemCount: folder.item_count ?? 0 })));
    const totalPages = parsed.data.pagination?.total_pages ?? 1;
    if (page >= totalPages || parsed.data.data.length === 0) break;
  }
  return folders;
}

let cachedCompetitors: { competitors: SpectreCompetitor[]; exp: number } | null = null;

/**
 * The competitor brands tracked in BrandSearch Spectre (Swipe Files → Spectre),
 * deduped across folders, minus CelluMove itself. Cached for 10 minutes, so a
 * brand added in Spectre shows up on the spy page shortly after.
 */
export async function listSpectreCompetitors(): Promise<SpectreCompetitor[]> {
  const now = Date.now();
  if (cachedCompetitors && cachedCompetitors.exp > now) return cachedCompetitors.competitors;

  const byDomain = new Map<string, SpectreCompetitor>();
  for (const folder of await listSpectreFolders()) {
    const { payload } = await getJson(`/v1/swipe/spectre-folders/${encodeURIComponent(folder.id)}`);
    const parsed = SpectreFolderDetailSchema.safeParse(payload);
    if (!parsed.success) throw new Error("BrandSearch returned an unexpected Spectre folder.");
    for (const item of parsed.data.items) {
      const domain = normalizeDomain(item.brand_id || item.url || "");
      if (!domain || isOwnBrand(domain) || byDomain.has(domain)) continue;
      byDomain.set(domain, { domain, name: item.name?.trim() || domain });
    }
  }

  const competitors = [...byDomain.values()];
  cachedCompetitors = { competitors, exp: now + 10 * 60 * 1000 };
  return competitors;
}

/**
 * Active Meta ads from every Spectre-tracked competitor, top spenders first per
 * brand. Costs 1 BrandSearch credit per returned row (incl. own-brand rows,
 * which are dropped here).
 */
export async function fetchSpectreMetaAds(input: {
  maxAdsPerBrand?: number;
  /** "active" (default, what /spy shows) or "all" — the corpus wants ended ads too, for their definitive run length. */
  status?: "active" | "all";
  /** Pages per folder. 5 suits the spy feed; a corpus pull at 25/brand needs more. */
  maxPages?: number;
} = {}): Promise<BrandSearchImportResult> {
  const maxAdsPerBrand = Math.min(50, Math.max(1, input.maxAdsPerBrand ?? 3));
  const status = input.status ?? "active";
  const maxPages = Math.min(50, Math.max(1, input.maxPages ?? 5));
  const byId = new Map<string, NormalizedBrandSearchAd>();
  let creditsUsed: number | null = null;
  let dailyRemaining: number | null = null;
  let monthlyRemaining: number | null = null;

  for (const folder of await listSpectreFolders()) {
    if (folder.itemCount === 0) continue;
    // Rows come back grouped per tracked brand, so the folder yields at most
    // itemCount × maxAdsPerBrand rows; `pagination.total` counts every ad.
    const expected = folder.itemCount * maxAdsPerBrand;
    const pageSize = Math.min(100, expected);
    let collected = 0;
    for (let page = 1; page <= maxPages && collected < expected; page++) {
      const params = new URLSearchParams({
        max_ads_per_brand: String(maxAdsPerBrand),
        ...(status === "active" ? { status: "active" } : {}),
        sort_by: "eu_total_spend",
        sort_order: "desc",
        fields: META_FIELDS,
        page: String(page),
        page_size: String(pageSize),
      });
      const { payload, headers } = await getJson(`/v1/swipe/spectre-folders/${encodeURIComponent(folder.id)}/ads?${params}`);
      const parsed = SpectreAdsResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("BrandSearch returned an unexpected Spectre ads response.");

      const credits = headerNumber(headers, "X-Credits-Used");
      if (credits !== null) creditsUsed = (creditsUsed ?? 0) + credits;
      dailyRemaining = headerNumber(headers, "X-Quota-Daily-Remaining") ?? dailyRemaining;
      monthlyRemaining = headerNumber(headers, "X-Quota-Monthly-Remaining") ?? monthlyRemaining;

      for (const row of parsed.data.data) {
        const ad = normalizeBrandSearchMetaAd(row, "spectre");
        if (ad.brandDomain && isOwnBrand(ad.brandDomain)) continue;
        byId.set(ad.externalId, ad);
      }
      collected += parsed.data.data.length;
      if (parsed.data.data.length < pageSize) break;
    }
  }

  return { ads: [...byId.values()], creditsUsed, dailyRemaining, monthlyRemaining };
}

