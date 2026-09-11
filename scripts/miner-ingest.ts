// INGEST: pull every Spectre-tracked competitor's Meta ads (ended ones too)
// into CompetitorAd, then download the videos straight away — BrandSearch
// media links die three days after the fetch.
//
//   npm run miner:ingest                       (25 ads/brand, all statuses)
//   npm run miner:ingest -- --per-brand 5 --status active
//   npm run miner:ingest -- --dry-run          (fetch + report, write nothing; still spends credits)
//   npm run miner:ingest -- --no-media         (skip the chained download)
//
// Each returned ad row costs one BrandSearch credit.

import { downloadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { ingestSpectreCorpus } from "../src/lib/cellumove/corpus/ingest.server";
import { loadCompetitorAds } from "../src/lib/cellumove/corpus/state.server";
import { fail, parseMinerArgs, printSummary, runLanes } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  console.log(`Ingesting Spectre Meta ads · ${args.perBrand ?? 25}/brand · status ${args.status ?? "all"}${args.dryRun ? " · DRY RUN" : ""}`);
  const result = await ingestSpectreCorpus({
    perBrand: args.perBrand ?? undefined,
    status: args.status ?? undefined,
    maxPages: args.maxPages ?? undefined,
    dryRun: args.dryRun,
  });
  const brands = new Set(result.rows.map((row) => row.brandName)).size;
  console.log(`${result.rows.length} ads from ${brands} brands · ${result.videoCount} video · ${result.newIds.length} new · ${result.videoChangedIds.length} with new video links`);
  console.log(`BrandSearch credits used: ${result.creditsUsed ?? "?"} · daily remaining ${result.dailyRemaining ?? "?"} · monthly remaining ${result.monthlyRemaining ?? "?"}`);
  if (!result.written) {
    console.log("Dry run — nothing written.");
    return;
  }

  if (args.noMedia) return;
  const ids = [...new Set(result.videoChangedIds)];
  if (!ids.length) {
    console.log("No new or changed video links to download.");
    return;
  }
  console.log(`\nDownloading ${ids.length} video(s) before the links expire…`);
  const ads = await loadCompetitorAds({ ids });
  const summary = await runLanes(ads, args.concurrency ?? 3, (ad) => `${ad.brandName} · ${ad.id}`, async (ad) => {
    const media = await downloadAdMedia(ad, { force: args.force });
    return media.status === "downloaded" ? `${((media.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB` : `${media.status}: ${media.statusReason ?? ""}`;
  });
  printSummary("media", summary);
}

main().catch(fail);
