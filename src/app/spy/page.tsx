import { brandSearchResearchEnabled, listResearchSnapshots } from "@/lib/brandsearch-research.server";
import { supabase } from "@/lib/db";
import type { SpyAd } from "../actions/spy";
import { bankedSourceUrls } from "../actions/bank";
import { SpyClient } from "./SpyClient";
import { isBrandSearchConfigured, listSpectreCompetitors } from "@/lib/brandsearch.server";
import { getSessionUser } from "@/lib/auth";
import { loadAdTeardowns } from "@/lib/cellumove/corpus/teardown.server";
import { TEARDOWN_TYPICAL_COST_USD } from "@/lib/cellumove/corpus/teardown";

export const dynamic = "force-dynamic";

function parseAds(json: string): SpyAd[] {
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? (p as SpyAd[]) : [];
  } catch {
    return [];
  }
}

export default async function SpyPage() {
  // The feed is cached in the Research table: the newest BrandSearch Spectre
  // import (type "competitor_spy", queryPlan.cohort "spectre"). BrandSearch is
  // only called again on first load (no cache yet), when the cache's media links
  // expire (3 days), or when the user hits Refresh.
  // Competitors null = couldn't load; the client warns and shows the cache unfiltered.
  const [res, banked, competitors, user] = await Promise.all([
    supabase
      .from("Research")
      .select("id, drafts, createdAt")
      .eq("type", "competitor_spy")
      .eq("queryPlan->>cohort", "spectre")
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
    bankedSourceUrls(),
    isBrandSearchConfigured()
      ? listSpectreCompetitors().catch((e: unknown) => {
          console.error("[spy] Spectre competitor list failed:", e);
          return null;
        })
      : Promise.resolve(null),
    getSessionUser(),
  ]);
  const row = res.error ? null : res.data;
  const ads = row ? parseAds(row.drafts) : [];
  const [teardowns, recentResult] = await Promise.all([
    loadAdTeardowns({ ids: ads.flatMap((ad) => ad.competitorAdId ? [ad.competitorAdId] : []) }),
    supabase.from("AdTeardown").select("competitorAdId, submittedAt, status").order("submittedAt", { ascending: false }).limit(20),
  ]);
  if (recentResult.error) throw new Error(recentResult.error.message);
  const recentRows = recentResult.data ?? [];
  const brands = recentRows.length ? await supabase.from("CompetitorAd").select("id, brandName").in("id", recentRows.map((item) => item.competitorAdId)) : null;
  if (brands?.error) throw new Error(brands.error.message);
  const brandNames = new Map((brands?.data ?? []).map((ad) => [ad.id, ad.brandName]));

  const research = await listResearchSnapshots();
  return (
    <SpyClient
      cached={row ? { id: row.id, ads, createdAt: row.createdAt } : null}
      teardownStatus={Object.fromEntries([...recentRows, ...teardowns].map((item) => [item.competitorAdId, item.status]))}
      researchEnabled={brandSearchResearchEnabled()}
      researchIds={Object.fromEntries(research.map((r) => [r.competitorAdId, r.id]))}
      costPerAd={TEARDOWN_TYPICAL_COST_USD}
      recentTeardowns={recentRows.map((item) => ({ adId: item.competitorAdId, brand: brandNames.get(item.competitorAdId) ?? "Unknown brand", submittedAt: item.submittedAt }))}
      bankedUrls={banked}
      brandSearchConfigured={isBrandSearchConfigured()}
      // Fetching spends BrandSearch credits, so only strategists (who can run
      // the import action) refresh — by hand or automatically on expiry.
      canRefresh={user?.role === "creative_strategist"}
      competitors={competitors}
    />
  );
}
