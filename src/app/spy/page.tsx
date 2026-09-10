import { supabase } from "@/lib/db";
import type { SpyAd } from "../actions/spy";
import { bankedSourceUrls } from "../actions/bank";
import { SpyClient } from "./SpyClient";
import { isBrandSearchConfigured, listSpectreCompetitors } from "@/lib/brandsearch.server";
import { getSessionUser } from "@/lib/auth";

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

  return (
    <SpyClient
      cached={row ? { id: row.id, ads: parseAds(row.drafts), createdAt: row.createdAt } : null}
      bankedUrls={banked}
      brandSearchConfigured={isBrandSearchConfigured()}
      // Fetching spends BrandSearch credits, so only strategists (who can run
      // the import action) refresh — by hand or automatically on expiry.
      canRefresh={user?.role === "creative_strategist"}
      competitors={competitors}
    />
  );
}
