import "server-only";

import { BRANDSEARCH_MEDIA_TTL_MS, type NormalizedBrandSearchAd } from "@/lib/brandsearch";
import { fetchBrandWinners, listSpectreCompetitors } from "@/lib/brandsearch.server";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { toCompetitorAdRow, type CompetitorAdUpsertRow } from "./ingest";
import {
  balancedTrim, brandsToExtend, fairShare, WINNER_DEFAULT_MIN_DAYS, WINNER_DEFAULT_TARGET, WINNER_RULE_VERSION,
  winnerCutoff, winnerRuleLabel, type BrandProgress,
} from "./winners";

export type CollectWinnersInput = {
  target?: number;
  minDays?: number;
  /** Fetch and report only; write nothing. Still spends credits. */
  dryRun?: boolean;
};

export type WinnerRow = CompetitorAdUpsertRow & { corpusIncluded: boolean; winnerPick: Json };

export type CollectWinnersResult = {
  rows: WinnerRow[];
  perBrand: Array<{ domain: string; picked: number; available: number | null }>;
  /** Tracked competitors with no qualifying winner at all. */
  empty: string[];
  newIds: string[];
  /** Picked ads whose video URL changed (or appeared) — download them promptly. */
  videoChangedIds: string[];
  /** Ads that were in the corpus before this pick and are now excluded (kept, not deleted). */
  excluded: number;
  target: number;
  cutoff: string;
  creditsUsed: number;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  written: boolean;
};

const spendOf = (ad: NormalizedBrandSearchAd) => (typeof ad.metrics.euTotalSpend === "number" ? ad.metrics.euTotalSpend : 0);

export async function collectWinners(input: CollectWinnersInput = {}): Promise<CollectWinnersResult> {
  const target = Math.max(1, Math.min(500, input.target ?? WINNER_DEFAULT_TARGET));
  const minDays = Math.max(1, input.minDays ?? WINNER_DEFAULT_MIN_DAYS);
  const competitors = await listSpectreCompetitors();
  if (!competitors.length) throw new Error("No competitors are tracked in BrandSearch Spectre yet.");

  const cutoff = winnerCutoff(Date.now(), minDays);
  const share = fairShare(target, competitors.length);
  const pool = new Map<string, NormalizedBrandSearchAd[]>(competitors.map((brand) => [brand.domain, []]));
  const progress = new Map<string, BrandProgress & { page: number }>(competitors.map((brand) => [brand.domain, { domain: brand.domain, fetched: 0, total: null, exhausted: false, page: 0 }]));
  const seen = new Set<string>();
  let creditsUsed = 0;
  let dailyRemaining: number | null = null;
  let monthlyRemaining: number | null = null;

  // Every page uses the same size so page N+1 continues exactly where N ended.
  const fetchNextPage = async (domain: string) => {
    const state = progress.get(domain)!;
    state.page += 1;
    const page = await fetchBrandWinners({ domain, startedOnOrBefore: cutoff, page: state.page, pageSize: share });
    creditsUsed += page.creditsUsed ?? page.ads.length;
    dailyRemaining = page.dailyRemaining ?? dailyRemaining;
    monthlyRemaining = page.monthlyRemaining ?? monthlyRemaining;
    for (const ad of page.ads) {
      if (ad.mediaType !== "video" || seen.has(ad.externalId)) continue;
      seen.add(ad.externalId);
      pool.get(domain)!.push(ad);
    }
    state.fetched += page.ads.length;
    state.total = page.total;
    state.exhausted = page.ads.length < share || (page.total != null && state.fetched >= page.total);
  };

  const runAll = async (domains: string[]) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, domains.length) }, async () => {
      while (cursor < domains.length) await fetchNextPage(domains[cursor++]!);
    }));
  };

  await runAll(competitors.map((brand) => brand.domain));
  for (let round = 0; round < 10; round += 1) {
    const have = [...pool.values()].reduce((sum, ads) => sum + ads.length, 0);
    const extend = brandsToExtend([...progress.values()], target - have, share);
    if (!extend.length) break;
    await runAll(extend);
  }

  for (const ads of pool.values()) ads.sort((a, b) => spendOf(b) - spendOf(a));
  const picked = balancedTrim(pool, target, spendOf);

  const now = new Date();
  const pickedAt = now.toISOString();
  const mediaExpiresAt = new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString();
  const rows: WinnerRow[] = [];
  for (const [domain, ads] of picked) {
    ads.forEach((ad, index) => {
      const days = typeof ad.metrics.totalActiveTimeSec === "number" ? Math.floor(ad.metrics.totalActiveTimeSec / 86_400) : null;
      const row = toCompetitorAdRow({ ...ad, winnerEvidence: "probable_winner", evidenceReasons: [`still running${days != null ? ` after ${days} days` : ` ${minDays}+ days after launch`}`, ...ad.evidenceReasons.filter((reason) => !reason.endsWith("days active"))] }, pickedAt, mediaExpiresAt);
      rows.push({
        ...row,
        corpusIncluded: true,
        winnerPick: { ruleVersion: WINNER_RULE_VERSION, rule: winnerRuleLabel(minDays), minDays, cutoff, brand: domain, brandRank: index + 1, target, pickedAt },
      });
    });
  }

  const ids = rows.map((row) => row.id);
  const existing = new Map<string, string | null>();
  if (ids.length) {
    const before = await supabase.from("CompetitorAd").select("id, videoUrl").in("id", ids);
    if (before.error) throw new Error(before.error.message);
    for (const row of before.data ?? []) existing.set(row.id, row.videoUrl);
  }
  const previouslyIncluded = await supabase.from("CompetitorAd").select("id").eq("corpusIncluded", true);
  if (previouslyIncluded.error) throw new Error(previouslyIncluded.error.message);
  const pickedIds = new Set(ids);
  const toExclude = (previouslyIncluded.data ?? []).map((row) => row.id).filter((id) => !pickedIds.has(id));

  if (!input.dryRun && rows.length) {
    const upsert = await supabase.from("CompetitorAd").upsert(rows, { onConflict: "provider,platform,externalId", ignoreDuplicates: false });
    if (upsert.error) {
      if (/winnerPick/.test(upsert.error.message)) throw new Error("CompetitorAd.winnerPick is missing — apply migrations/020_corpus_winner_pick.sql first.");
      throw new Error(`Could not save the winners: ${upsert.error.message}`);
    }
    // The pick is the corpus: everything else stays stored (with its media,
    // transcripts and beats) but leaves the corpus until a later pick brings it back.
    for (let i = 0; i < toExclude.length; i += 200) {
      const exclude = await supabase.from("CompetitorAd").update({ corpusIncluded: false, winnerPick: null }).in("id", toExclude.slice(i, i + 200));
      if (exclude.error) throw new Error(`Could not update the corpus: ${exclude.error.message}`);
    }
  }

  return {
    rows,
    perBrand: competitors.map((brand) => ({ domain: brand.domain, picked: picked.get(brand.domain)?.length ?? 0, available: progress.get(brand.domain)!.total })),
    empty: competitors.filter((brand) => !(picked.get(brand.domain)?.length)).map((brand) => brand.domain),
    newIds: ids.filter((id) => !existing.has(id)),
    videoChangedIds: rows.filter((row) => row.videoUrl && existing.get(row.id) !== row.videoUrl).map((row) => row.id),
    excluded: toExclude.length,
    target,
    cutoff,
    creditsUsed,
    dailyRemaining,
    monthlyRemaining,
    written: !input.dryRun,
  };
}
