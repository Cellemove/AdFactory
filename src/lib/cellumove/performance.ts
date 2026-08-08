// Pure KPI formatting — no DB, no server-only. Lives outside the "use server"
// actions file so it can be imported by server components and the actions alike.
import type { PerformanceEntryRow } from "@/lib/database.types";

/** Blend a winner's KPI entries into one human-readable line for the iterate prompt / UI. */
export function summarizePerformance(entries: PerformanceEntryRow[]): string | null {
  if (!entries.length) return null;
  let spend = 0, impressions = 0, clicks = 0, purchases = 0, roasWeighted = 0, roasSpend = 0;
  for (const e of entries) {
    spend += e.spend || 0;
    impressions += e.impressions || 0;
    clicks += e.clicks || 0;
    purchases += e.purchases || 0;
    if (e.roas != null && e.spend > 0) {
      roasWeighted += e.roas * e.spend;
      roasSpend += e.spend;
    }
  }
  const parts: string[] = [];
  if (spend > 0) parts.push(`spend $${Math.round(spend).toLocaleString()}`);
  if (roasSpend > 0) parts.push(`ROAS ${(roasWeighted / roasSpend).toFixed(2)}`);
  if (impressions > 0) parts.push(`CTR ${((clicks / impressions) * 100).toFixed(2)}%`);
  if (purchases > 0) parts.push(`CPA $${(spend / purchases).toFixed(2)}`);
  if (purchases > 0) parts.push(`${purchases.toLocaleString()} purchases`);
  if (impressions > 0) parts.push(`${impressions.toLocaleString()} impressions`);
  if (!parts.length) return null;
  return `${parts.join(" · ")} (across ${entries.length} report${entries.length === 1 ? "" : "s"})`;
}
