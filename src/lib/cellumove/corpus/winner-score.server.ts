import "server-only";

import type { CompetitorAdRow, Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { WINNER_SCORE_VERSION } from "./constants";
import { rankWinnerScores } from "./winner-score";

export type RefreshWinnerScoresResult = { scored: number; updated: number };

/** Recompute the longevity ranking for the whole corpus; write only rows whose value changed. */
export async function refreshWinnerScores(filter: { brand?: string } = {}): Promise<RefreshWinnerScoresResult> {
  let query = supabase.from("CompetitorAd").select("*");
  if (filter.brand) query = query.eq("brandName", filter.brand);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  const ads = (result.data ?? []) as CompetitorAdRow[];
  const scores = rankWinnerScores(ads);
  let updated = 0;
  for (const ad of ads) {
    const scored = scores.get(ad.id);
    if (!scored) continue;
    const unchanged = ad.winnerScore != null && Math.abs(ad.winnerScore - scored.score) < 0.005 && ad.winnerScoreVersion === WINNER_SCORE_VERSION;
    if (unchanged) continue;
    const write = await supabase.from("CompetitorAd").update({
      winnerScore: scored.score,
      winnerScoreVersion: WINNER_SCORE_VERSION,
      winnerScoreInputs: scored.breakdown as unknown as Json,
      updatedAt: new Date().toISOString(),
    }).eq("id", ad.id);
    if (write.error) throw new Error(write.error.message);
    updated += 1;
  }
  return { scored: ads.length, updated };
}
