import { supabase } from "@/lib/db";
import type { ResearchRow } from "@/lib/database.types";
import type { SpyAd } from "../actions/spy";
import { SpyClient } from "./SpyClient";

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
  // Past sweeps live in the Research table under type "competitor_spy". Show the
  // latest one's gallery immediately, plus a short history. Fail-soft on errors.
  const res = await supabase
    .from("Research")
    .select("*")
    .eq("type", "competitor_spy")
    .order("createdAt", { ascending: false })
    .limit(20);
  const rows = res.error ? [] : (res.data as ResearchRow[]);

  const latest = rows[0]
    ? { id: rows[0].id, ads: parseAds(rows[0].drafts), focus: rows[0].focus, createdAt: rows[0].createdAt }
    : null;

  const history = rows.map((r) => ({
    id: r.id,
    focus: r.focus,
    drafts: r.drafts,
    createdAt: r.createdAt,
    count: parseAds(r.drafts).length,
  }));

  return <SpyClient latest={latest} history={history} />;
}
