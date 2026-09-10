"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/db";

// ─── COMPETITOR SPY ──────────────────────────────────────────────────────────
// The spy feed is the Meta ads of the competitors tracked in BrandSearch
// Spectre, fetched by importBrandSearchMetaAds() (./brandsearch) and cached as a
// Research row (type: "competitor_spy"). Sweeps are curatable via updateSpyAds()
// so the user can drop entries they don't want.

export interface SpyAd {
  brand: string;            // brand / advertiser name
  brandDomain?: string;     // tracked Spectre competitor domain this creative belongs to
  imageUrl: string;         // renderable creative image
  sourceUrl: string;        // link to the ad / post
  caption: string;          // the hook / headline / ad copy line
  platform: string;         // Meta / Instagram / TikTok / YouTube
  mediaType: "image" | "video";
  // Link-verification flags from the retired Gemini web sweep; legacy rows only.
  verified?: boolean;       // sourceUrl actually loaded (live, not a dead/fake link)
  contentMatch?: boolean;   // the brand or caption actually appears on that page
  linkFallback?: boolean;   // sourceUrl was swapped for the brand's Ads Library page
  // Provider-backed evidence (BrandSearch imports).
  provider?: string;
  providerId?: string;
  providerUrl?: string;
  winnerEvidence?: "observed" | "probable_winner" | "verified_winner";
  evidenceReasons?: string[];
  evidenceMetrics?: Record<string, string | number | boolean | null>;
  transcriptUrl?: string;
  mediaExpiresAt?: string;
}

/**
 * Curate a saved sweep — overwrite its creative list (e.g. after the user removes
 * entries they don't want). Persists to the same Research row.
 */
export async function updateSpyAds(id: string, ads: SpyAd[]): Promise<void> {
  if (!id) throw new Error("Missing sweep id.");
  const res = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(ads) })
    .eq("id", id)
    .eq("type", "competitor_spy");
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/spy");
}
