// MEDIA: download each video ad's file into corpus-media/ and record it in
// AdMedia (sha256, bytes, mime). Skips ads with a verified local copy.
//
//   npm run miner:media
//   npm run miner:media -- --limit 3
//   npm run miner:media -- --ad cad_… --force
//   npm run miner:media -- --brand onecompress.com

import { downloadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { fail, parseMinerArgs, printSummary, runLanes, selectAdsForStage } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const ads = await selectAdsForStage("media", args);
  if (!ads.length) {
    console.log("Nothing to download — every eligible video already has a local copy (use --force to re-download).");
    return;
  }
  console.log(`Downloading ${ads.length} video(s) on ${args.concurrency ?? 3} lanes…`);
  const summary = await runLanes(ads, args.concurrency ?? 3, (ad) => `${ad.brandName} · ${ad.id}`, async (ad) => {
    const media = await downloadAdMedia(ad, { force: args.force });
    if (media.status === "downloaded") return `${((media.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB · ${media.mime}`;
    return `${media.status}: ${media.statusReason ?? ""}`;
  });
  printSummary("media", summary);
}

main().catch(fail);
