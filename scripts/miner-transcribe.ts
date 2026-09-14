// TRANSCRIBE: one Gemini call per downloaded video → timecoded vo + ost
// segments in CorpusTranscriptSegment. Idempotent by (ad, media hash, prompt
// version, model).
//
//   npm run miner:transcribe
//   npm run miner:transcribe -- --limit 2
//   npm run miner:transcribe -- --ad cad_… --force

import { loadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { transcribeAd } from "../src/lib/cellumove/corpus/transcribe.server";
import { fail, parseMinerArgs, printSummary, runLanes, selectAdsForStage, usageCost, usd } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const ads = await selectAdsForStage("transcribe", args);
  if (!ads.length) {
    console.log("Nothing to transcribe — every downloaded video already has a complete transcript (use --force to redo).");
    return;
  }
  console.log(`Transcribing ${ads.length} ad(s) on ${args.concurrency ?? 2} lanes…`);
  let cost = 0;
  const summary = await runLanes(ads, args.concurrency ?? 2, (ad) => `${ad.brandName} · ${ad.id}`, async (ad) => {
    const media = await loadAdMedia(ad.id);
    if (!media) throw new Error("No AdMedia row — run miner:media first.");
    const result = await transcribeAd(ad, media, { force: args.force });
    if (result.reused) return "skip";
    cost += usageCost(result.run.usage) ?? 0;
    const vo = result.segments.filter((segment) => segment.channel === "vo").length;
    const ost = result.segments.length - vo;
    const check = result.run.crossCheck && typeof result.run.crossCheck === "object" ? (result.run.crossCheck as { verdict?: string }).verdict : null;
    return `${result.run.durationSec ?? "?"}s · ${vo} vo · ${ost} ost · ${result.run.language ?? "?"}${check && check !== "unavailable" ? ` · cross-check ${check}` : ""} · ${usd(usageCost(result.run.usage))}`;
  });
  printSummary("transcribe", summary);
  console.log(`Estimated model cost this run: ${usd(cost)}`);
}

main().catch(fail);
