// The whole pipeline in order: ingest → media → transcribe → extract → score
// → mine. Each stage is the same code as its standalone runner and skips work
// it has already done, so this is safe to re-run.
//
//   npm run miner:run
//   npm run miner:run -- --until transcribe --limit 5
//   npm run miner:run -- --skip-gate            (extract before Gate 1 has passed)
//   npm run miner:run -- --no-ingest            (start from what is already indexed)

import { CORPUS_TAXONOMY_VERSION } from "../src/lib/cellumove/corpus/constants";
import { extractAdBeats } from "../src/lib/cellumove/corpus/extract.server";
import { ingestSpectreCorpus } from "../src/lib/cellumove/corpus/ingest.server";
import { downloadAdMedia, loadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { mineAndSaveReports } from "../src/lib/cellumove/corpus/mine.server";
import { renderReportText } from "../src/lib/cellumove/corpus/report";
import { latestCompleteTranscriptRun, transcribeAd } from "../src/lib/cellumove/corpus/transcribe.server";
import { refreshWinnerScores } from "../src/lib/cellumove/corpus/winner-score.server";
import { fail, parseMinerArgs, printSummary, runLanes, selectAdsForStage } from "./lib/miner-cli";
import { assertGate1 } from "./miner-extract";

const STAGES = ["ingest", "media", "transcribe", "extract", "score", "mine"] as const;

async function main() {
  const args = parseMinerArgs();
  const stopAfter = args.until ? STAGES.indexOf(args.until as (typeof STAGES)[number]) : STAGES.length - 1;
  if (stopAfter < 0) throw new Error(`--until must be one of ${STAGES.join(", ")}.`);
  const skipIngest = process.argv.includes("--no-ingest");
  const label = (ad: { brandName: string; id: string }) => `${ad.brandName} · ${ad.id}`;

  if (!skipIngest) {
    console.log("\n▶ ingest");
    const ingest = await ingestSpectreCorpus({ perBrand: args.perBrand ?? undefined, status: args.status ?? undefined, maxPages: args.maxPages ?? undefined, dryRun: args.dryRun });
    console.log(`${ingest.rows.length} ads · ${ingest.newIds.length} new · credits used ${ingest.creditsUsed ?? "?"}`);
  }
  if (stopAfter < 1 || args.dryRun) return;

  console.log("\n▶ media");
  printSummary("media", await runLanes(await selectAdsForStage("media", args), args.concurrency ?? 3, label, async (ad) => {
    const media = await downloadAdMedia(ad, { force: args.force });
    return media.status === "downloaded" ? "ok" : `${media.status}: ${media.statusReason ?? ""}`;
  }));
  if (stopAfter < 2) return;

  console.log("\n▶ transcribe");
  printSummary("transcribe", await runLanes(await selectAdsForStage("transcribe", args), args.concurrency ?? 2, label, async (ad) => {
    const media = await loadAdMedia(ad.id);
    if (!media) throw new Error("No AdMedia row.");
    const result = await transcribeAd(ad, media, { force: args.force });
    return result.reused ? "skip" : `${result.segments.length} segments`;
  }));
  if (stopAfter < 3) return;

  console.log("\n▶ extract");
  const taxonomyVersion = args.taxonomy ?? CORPUS_TAXONOMY_VERSION;
  await assertGate1(taxonomyVersion, args.skipGate);
  printSummary("extract", await runLanes(await selectAdsForStage("extract", args), args.concurrency ?? 2, label, async (ad) => {
    const transcriptRun = await latestCompleteTranscriptRun(ad.id);
    if (!transcriptRun) throw new Error("No complete transcript.");
    const media = args.withVideo ? await loadAdMedia(ad.id) : null;
    const result = await extractAdBeats(ad, transcriptRun, { force: args.force, retryReview: args.retryReview, withVideo: args.withVideo, media, taxonomyVersion });
    if (result.reused) return "skip";
    return result.run.status === "needs_human_review" ? `QUARANTINED: ${result.run.errorSummary?.slice(0, 120) ?? ""}` : `${result.beats.length} beats`;
  }));
  if (stopAfter < 4) return;

  console.log("\n▶ score");
  const scored = await refreshWinnerScores();
  console.log(`Scored ${scored.scored} ads · ${scored.updated} updated.`);
  if (stopAfter < 5) return;

  console.log("\n▶ mine");
  const mined = await mineAndSaveReports({ taxonomyVersion, minSupport: args.minSupport ?? undefined });
  if (mined.all) console.log(renderReportText(mined.all));
  console.log(`${mined.written} snapshot(s) written · ${mined.unchanged} unchanged.`);
}

main().catch(fail);
