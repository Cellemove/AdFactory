import "server-only";

import { BRANDSEARCH_MEDIA_TTL_MS } from "@/lib/brandsearch";
import { fetchSpectreMetaAds } from "@/lib/brandsearch.server";
import { supabase } from "@/lib/db";
import { toCompetitorAdRow, type CompetitorAdUpsertRow } from "./ingest";

export type IngestCorpusInput = {
  /** Ads per tracked brand, top spenders first. Each returned row costs one BrandSearch credit. */
  perBrand?: number;
  /** "all" includes ended ads — they carry a definitive start/end and therefore a real days-active figure. */
  status?: "active" | "all";
  maxPages?: number;
  /** Fetch and report only; write nothing. Still spends credits. */
  dryRun?: boolean;
};

export type IngestCorpusResult = {
  rows: CompetitorAdUpsertRow[];
  /** Ids that did not exist before this run. */
  newIds: string[];
  /** Ids whose video URL changed (or appeared) — their media should be (re)downloaded promptly. */
  videoChangedIds: string[];
  videoCount: number;
  creditsUsed: number | null;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  written: boolean;
};

const TABLE_MISSING = "PGRST205";

export async function ingestSpectreCorpus(input: IngestCorpusInput = {}): Promise<IngestCorpusResult> {
  const imported = await fetchSpectreMetaAds({
    maxAdsPerBrand: input.perBrand ?? 25,
    status: input.status ?? "all",
    maxPages: input.maxPages ?? 10,
  });
  const now = new Date();
  const fetchedAt = now.toISOString();
  const mediaExpiresAt = new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString();
  const rows = imported.ads.map((ad) => toCompetitorAdRow(ad, fetchedAt, mediaExpiresAt));

  const ids = rows.map((row) => row.id);
  const existingById = new Map<string, { videoUrl: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const existing = await supabase.from("CompetitorAd").select("id, videoUrl").in("id", chunk);
    if (existing.error) {
      if (existing.error.code === TABLE_MISSING) throw new Error("CompetitorAd is missing — apply migrations/016_brandsearch_competitor_ads.sql first.");
      throw new Error(existing.error.message);
    }
    for (const row of existing.data ?? []) existingById.set(row.id, { videoUrl: row.videoUrl });
  }
  const newIds = rows.filter((row) => !existingById.has(row.id)).map((row) => row.id);
  const videoChangedIds = rows
    .filter((row) => row.mediaType === "video" && row.videoUrl && existingById.get(row.id)?.videoUrl !== row.videoUrl)
    .map((row) => row.id);

  if (!input.dryRun && rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      const upsert = await supabase.from("CompetitorAd").upsert(rows.slice(i, i + 200), {
        onConflict: "provider,platform,externalId",
        ignoreDuplicates: false,
      });
      if (upsert.error) throw new Error(`Could not index BrandSearch ads: ${upsert.error.message}`);
    }
  }

  return {
    rows,
    newIds,
    videoChangedIds,
    videoCount: rows.filter((row) => row.mediaType === "video").length,
    creditsUsed: imported.creditsUsed,
    dailyRemaining: imported.dailyRemaining,
    monthlyRemaining: imported.monthlyRemaining,
    written: !input.dryRun,
  };
}
