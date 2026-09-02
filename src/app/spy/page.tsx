import { supabase } from "@/lib/db";
import type { ResearchRow } from "@/lib/database.types";
import type { SpyAd } from "../actions/spy";
import { bankedSourceUrls } from "../actions/bank";
import { SpyClient } from "./SpyClient";
import { DEFAULT_SPY_NICHE_SLUG, getSpyNiche, SPY_NICHES } from "@/lib/cellumove/spy-niches";

export const dynamic = "force-dynamic";

function parseAds(json: string): SpyAd[] {
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? (p as SpyAd[]) : [];
  } catch {
    return [];
  }
}

function parseNiche(queryPlan: ResearchRow["queryPlan"]) {
  try {
    const parsed = typeof queryPlan === "string" ? JSON.parse(queryPlan) : queryPlan;
    return getSpyNiche(parsed?.niche?.slug ?? DEFAULT_SPY_NICHE_SLUG);
  } catch {
    return getSpyNiche(DEFAULT_SPY_NICHE_SLUG);
  }
}

export default async function SpyPage() {
  // Past sweeps live in the Research table under type "competitor_spy". Show the
  // latest one's gallery immediately, plus a short history. Fail-soft on errors.
  const [res, banked] = await Promise.all([
    supabase
      .from("Research")
      .select("*")
      .eq("type", "competitor_spy")
      .order("createdAt", { ascending: false })
      .limit(20),
    bankedSourceUrls(),
  ]);
  const rows = res.error ? [] : (res.data as ResearchRow[]);

  const latest = rows[0]
    ? { id: rows[0].id, ads: parseAds(rows[0].drafts), focus: rows[0].focus, createdAt: rows[0].createdAt, niche: parseNiche(rows[0].queryPlan) }
    : null;

  const history = rows.map((r) => ({
    id: r.id,
    focus: r.focus,
    drafts: r.drafts,
    createdAt: r.createdAt,
    count: parseAds(r.drafts).length,
    niche: parseNiche(r.queryPlan),
  }));

  return <SpyClient latest={latest} history={history} bankedUrls={banked} niches={SPY_NICHES} />;
}
