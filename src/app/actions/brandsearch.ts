"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { requireStrategist } from "@/lib/authorization";
import { supabase, newId } from "@/lib/db";
import { BRANDSEARCH_MEDIA_TTL_MS } from "@/lib/brandsearch";
import {
  discoverBrandSearchMetaAds,
  testBrandSearchConnection,
} from "@/lib/brandsearch.server";
import { getSpyNiche } from "@/lib/cellumove/spy-niches";
import type { Json } from "@/lib/database.types";
import type { SpyAd } from "./spy";

const TABLE_MISSING = "PGRST205";

function competitorAdId(provider: string, platform: string, externalId: string): string {
  return `cad_${createHash("sha256").update(`${provider}:${platform}:${externalId}`).digest("hex").slice(0, 24)}`;
}

export async function verifyBrandSearch(): Promise<{
  accountLabel: string;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
}> {
  await requireStrategist();
  return testBrandSearchConnection();
}

export async function importBrandSearchMetaAds(input: {
  nicheSlug?: string | null;
  focus?: string | null;
  limit?: number;
}): Promise<{
  id: string;
  ads: SpyAd[];
  niche: ReturnType<typeof getSpyNiche>;
  creditsUsed: number | null;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  durableIndexUpdated: boolean;
}> {
  await requireStrategist();
  const niche = getSpyNiche(input.nicheSlug);
  const imported = await discoverBrandSearchMetaAds({
    nicheSlug: niche.slug,
    focus: input.focus,
    limit: input.limit,
  });
  if (imported.ads.length === 0) {
    throw new Error("BrandSearch found no scaling Meta ads for that filter. Try a broader focus.");
  }

  const now = new Date();
  const fetchedAt = now.toISOString();
  const mediaExpiresAt = new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString();
  const ads: SpyAd[] = imported.ads.map((ad) => ({
    brand: ad.brandName,
    imageUrl: ad.imageUrl,
    sourceUrl: ad.sourceUrl,
    caption: ad.copy,
    platform: ad.platform,
    mediaType: ad.mediaType,
    verified: true,
    contentMatch: true,
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
  const rows = imported.ads.map((ad) => ({
    id: competitorAdId(ad.provider, ad.platform.toLowerCase(), ad.externalId),
    provider: ad.provider,
    externalId: ad.externalId,
    platform: ad.platform.toLowerCase(),
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
  }));
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
    focus: input.focus?.trim() || null,
    drafts: JSON.stringify(ads),
    queryPlan: {
      niche,
      source: "brandsearch",
      platform: "meta",
      seed: imported.seed,
      winnerEvidence: "probable_winner",
      creditsUsed: imported.creditsUsed,
    },
    status: "pending",
    notes: durableIndexUpdated
      ? "BrandSearch Meta discover import; provider signals are performance proxies, not ROAS proof."
      : "BrandSearch Meta discover import; run migration 016 to enable durable provider indexing.",
    createdAt: fetchedAt,
  });
  if (research.error) throw new Error(research.error.message);

  revalidatePath("/spy");
  revalidatePath("/knowledge");
  return {
    id,
    ads,
    niche,
    creditsUsed: imported.creditsUsed,
    dailyRemaining: imported.dailyRemaining,
    monthlyRemaining: imported.monthlyRemaining,
    durableIndexUpdated,
  };
}
