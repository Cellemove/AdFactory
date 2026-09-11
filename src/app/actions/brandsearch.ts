"use server";

import { revalidatePath } from "next/cache";
import { requireStrategist } from "@/lib/authorization";
import { supabase, newId } from "@/lib/db";
import { BRANDSEARCH_MEDIA_TTL_MS, isFeedStale } from "@/lib/brandsearch";
import { fetchSpectreMetaAds } from "@/lib/brandsearch.server";
import { toCompetitorAdRow } from "@/lib/cellumove/corpus/ingest";
import type { SpyAd } from "./spy";

const TABLE_MISSING = "PGRST205";

type SpyFeedResult = {
  id: string;
  ads: SpyAd[];
  createdAt: string;
  /** True when a fresh cached feed was returned instead of calling BrandSearch. */
  reused: boolean;
  creditsUsed: number | null;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  durableIndexUpdated: boolean;
};

/** The newest cached Spectre feed, if its media links are still fresh. */
async function freshCachedFeed(): Promise<SpyFeedResult | null> {
  const res = await supabase
    .from("Research")
    .select("id, drafts, createdAt")
    .eq("type", "competitor_spy")
    .eq("queryPlan->>cohort", "spectre")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data || isFeedStale(res.data.createdAt)) return null;
  let ads: SpyAd[] = [];
  try {
    const parsed: unknown = JSON.parse(res.data.drafts);
    if (Array.isArray(parsed)) ads = parsed as SpyAd[];
  } catch {
    return null;
  }
  return {
    id: res.data.id,
    ads,
    createdAt: res.data.createdAt,
    reused: true,
    creditsUsed: null,
    dailyRemaining: null,
    monthlyRemaining: null,
    durableIndexUpdated: true,
  };
}

/**
 * Fetch the active Meta ads of every competitor tracked in BrandSearch Spectre
 * (top spenders per brand) and cache them as the spy feed. The page reads the
 * newest cached feed; this runs on first load, when the cache's media links
 * expire, or when the user hits Refresh.
 * `ifStale` (the automatic path) re-checks the cache first, so several viewers
 * opening an expired page don't each spend credits on the same refresh.
 */
export async function importBrandSearchMetaAds(input: {
  maxAdsPerBrand?: number;
  ifStale?: boolean;
} = {}): Promise<SpyFeedResult> {
  await requireStrategist();
  if (input.ifStale) {
    const cached = await freshCachedFeed();
    if (cached) return cached;
  }
  const imported = await fetchSpectreMetaAds({ maxAdsPerBrand: input.maxAdsPerBrand });
  if (imported.ads.length === 0) {
    throw new Error("None of your Spectre competitors have active Meta ads right now.");
  }

  const now = new Date();
  const fetchedAt = now.toISOString();
  const mediaExpiresAt = new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString();
  const ads: SpyAd[] = imported.ads.map((ad) => ({
    brand: ad.brandName,
    brandDomain: ad.brandDomain || undefined,
    imageUrl: ad.imageUrl,
    sourceUrl: ad.sourceUrl,
    caption: ad.copy,
    platform: ad.platform,
    mediaType: ad.mediaType,
    provider: ad.provider,
    providerId: ad.externalId,
    providerUrl: ad.dashboardUrl || undefined,
    winnerEvidence: ad.winnerEvidence,
    evidenceReasons: ad.evidenceReasons,
    evidenceMetrics: ad.metrics,
    transcriptUrl: ad.transcriptUrl || undefined,
    mediaExpiresAt,
  }));

  let durableIndexUpdated = true;
  // Same row shape the Corpus Miner writes, so both paths share the unique key.
  const rows = imported.ads.map((ad) => toCompetitorAdRow(ad, fetchedAt, mediaExpiresAt));
  const indexed = await supabase.from("CompetitorAd").upsert(rows, {
    onConflict: "provider,platform,externalId",
    ignoreDuplicates: false,
  });
  if (indexed.error) {
    if (indexed.error.code === TABLE_MISSING) durableIndexUpdated = false;
    else throw new Error(`Could not index BrandSearch ads: ${indexed.error.message}`);
  }

  const id = newId();
  const research = await supabase.from("Research").insert({
    id,
    type: "competitor_spy",
    angleSlug: null,
    focus: null,
    drafts: JSON.stringify(ads),
    queryPlan: {
      source: "brandsearch",
      cohort: "spectre",
      platform: "meta",
      creditsUsed: imported.creditsUsed,
    },
    status: "pending",
    notes: durableIndexUpdated
      ? "BrandSearch Spectre competitor import; provider signals are performance proxies, not ROAS proof."
      : "BrandSearch Spectre competitor import; run migration 016 to enable durable provider indexing.",
    createdAt: fetchedAt,
  });
  if (research.error) throw new Error(research.error.message);

  revalidatePath("/spy");
  revalidatePath("/knowledge");
  return {
    id,
    ads,
    createdAt: fetchedAt,
    reused: false,
    creditsUsed: imported.creditsUsed,
    dailyRemaining: imported.dailyRemaining,
    monthlyRemaining: imported.monthlyRemaining,
    durableIndexUpdated,
  };
}
