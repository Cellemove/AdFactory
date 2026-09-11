// WINNERS: build the corpus from ~100 winning ads spread across every Spectre
// competitor — videos still running 21+ days after launch, highest EU spend
// first. The pick becomes the corpus; other ads stay stored but excluded.
// 1 BrandSearch credit per ad fetched. Then chains the video download, because
// BrandSearch media links die after three days.
//
//   npm run miner:winners -- --dry-run            (fetch + report, write nothing; still spends credits)
//   npm run miner:winners                         (100 winners)
//   npm run miner:winners -- --limit 200          (a bigger corpus)
//   npm run miner:winners -- --no-media           (skip the download)

import { downloadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { loadCompetitorAds } from "../src/lib/cellumove/corpus/state.server";
import { collectWinners } from "../src/lib/cellumove/corpus/winners.server";
import { WINNER_DEFAULT_MIN_DAYS, winnerRuleLabel } from "../src/lib/cellumove/corpus/winners";
import { fail, parseMinerArgs, printSummary, runLanes } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const minDaysFlag = process.argv.indexOf("--min-days");
  const minDays = minDaysFlag > -1 ? Number(process.argv[minDaysFlag + 1]) : WINNER_DEFAULT_MIN_DAYS;
  if (!Number.isInteger(minDays) || minDays < 1) throw new Error("--min-days must be a positive integer.");

  console.log(`Collecting ${args.limit ?? 100} winners · ${winnerRuleLabel(minDays)}${args.dryRun ? " · DRY RUN" : ""}`);
  const result = await collectWinners({ target: args.limit ?? undefined, minDays, dryRun: args.dryRun });

  console.log(`\n${result.rows.length} winners picked (launched on or before ${result.cutoff}):`);
  for (const brand of [...result.perBrand].sort((a, b) => b.picked - a.picked)) {
    console.log(`  ${String(brand.picked).padStart(3)}  ${brand.domain}  (${brand.available ?? "?"} qualifying)`);
  }
  if (result.empty.length) console.log(`No qualifying winners: ${result.empty.join(", ")}`);
  console.log(`\n${result.newIds.length} new to the index · ${result.excluded} earlier corpus ads ${result.written ? "now excluded" : "would be excluded"} (kept, not deleted)`);
  console.log(`BrandSearch credits used: ${result.creditsUsed} · daily remaining ${result.dailyRemaining ?? "?"} · monthly remaining ${result.monthlyRemaining ?? "?"}`);
  if (!result.written) {
    console.log("Dry run — nothing written.");
    return;
  }

  if (args.noMedia || !result.videoChangedIds.length) return;
  console.log(`\nDownloading ${result.videoChangedIds.length} video(s) before the links expire…`);
  const ads = await loadCompetitorAds({ ids: result.videoChangedIds });
  const summary = await runLanes(ads, args.concurrency ?? 3, (ad) => `${ad.brandName} · ${ad.id}`, async (ad) => {
    // Provider links are re-signed on every fetch; an ad already stored keeps its copy.
    const media = await downloadAdMedia(ad);
    return media.status === "downloaded" ? `${((media.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB` : `${media.status}: ${media.statusReason ?? ""}`;
  });
  printSummary("media", summary);
}

main().catch(fail);
