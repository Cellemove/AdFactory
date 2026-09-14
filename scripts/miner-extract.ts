// EXTRACT: one Gemini call per transcribed ad (a second only when validation
// fails), producing AdBeat rows behind the evidence gate. Ads that fail twice
// are quarantined as needs_human_review and never get beats written.
//
// Refuses to run on the corpus until Gate 1 (miner:eval) has passed for the
// current taxonomy + prompt + model, unless --skip-gate is given.
//
//   npm run miner:extract -- --skip-gate --limit 2
//   npm run miner:extract -- --ad cad_… --with-video --force
//   npm run miner:extract -- --retry-review

import { CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_TAXONOMY_VERSION } from "../src/lib/cellumove/corpus/constants";
import { latestGate1 } from "../src/lib/cellumove/corpus/eval.server";
import { EXTRACT_MODEL, extractAdBeats } from "../src/lib/cellumove/corpus/extract.server";
import { loadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { latestCompleteTranscriptRun } from "../src/lib/cellumove/corpus/transcribe.server";
import { fail, parseMinerArgs, printSummary, runLanes, selectAdsForStage, usageCost, usd } from "./lib/miner-cli";

export async function assertGate1(taxonomyVersion: string, skipGate: boolean): Promise<void> {
  const gate = await latestGate1(taxonomyVersion);
  if (gate?.passed) {
    console.log(`Gate 1 passed on ${gate.createdAt} (layer ${gate.layerAgreement}, code ${gate.codeAgreement}) for ${taxonomyVersion} · ${CORPUS_EXTRACT_PROMPT_VERSION} · ${EXTRACT_MODEL}.`);
    return;
  }
  const state = gate ? `last run FAILED (layer ${gate.layerAgreement}, code ${gate.codeAgreement})` : "never run";
  if (!skipGate) {
    throw new Error(`Gate 1 has not passed for ${taxonomyVersion} · ${CORPUS_EXTRACT_PROMPT_VERSION} · ${EXTRACT_MODEL} (${state}). Run npm run miner:eval, or pass --skip-gate to extract anyway.`);
  }
  console.warn(`\n!!! GATE 1 SKIPPED — extractor accuracy is unverified for ${taxonomyVersion} · ${CORPUS_EXTRACT_PROMPT_VERSION} · ${EXTRACT_MODEL} (${state}). Treat these beats as provisional. !!!\n`);
}

async function main() {
  const args = parseMinerArgs();
  const taxonomyVersion = args.taxonomy ?? CORPUS_TAXONOMY_VERSION;
  await assertGate1(taxonomyVersion, args.skipGate);
  const ads = await selectAdsForStage("extract", args);
  if (!ads.length) {
    console.log("Nothing to extract — every transcribed ad already has beats (use --force to redo, --retry-review for quarantined ads).");
    return;
  }
  console.log(`Extracting ${ads.length} ad(s) with taxonomy ${taxonomyVersion}${args.withVideo ? " + video" : ""} on ${args.concurrency ?? 2} lanes…`);
  let cost = 0;
  let quarantined = 0;
  const summary = await runLanes(ads, args.concurrency ?? 2, (ad) => `${ad.brandName} · ${ad.id}`, async (ad) => {
    const transcriptRun = await latestCompleteTranscriptRun(ad.id);
    if (!transcriptRun) throw new Error("No complete transcript — run miner:transcribe first.");
    const media = args.withVideo ? await loadAdMedia(ad.id) : null;
    const result = await extractAdBeats(ad, transcriptRun, { force: args.force, retryReview: args.retryReview, withVideo: args.withVideo, media, taxonomyVersion });
    if (result.reused) return "skip";
    cost += usageCost(result.run.usage) ?? 0;
    if (result.run.status === "needs_human_review") {
      quarantined += 1;
      return `QUARANTINED after ${result.run.attempts} attempt(s): ${result.run.errorSummary?.slice(0, 160) ?? ""}`;
    }
    const low = result.beats.filter((beat) => (beat.matchScore ?? 100) < 100).length;
    return `${result.beats.length} beats (${result.beats.map((beat) => beat.code).join(" → ")}) · ${result.run.attempts} attempt(s) · ${low} fuzzy quote(s) · ${usd(usageCost(result.run.usage))}`;
  });
  printSummary("extract", summary);
  console.log(`Quarantined for review: ${quarantined} · estimated model cost this run: ${usd(cost)}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/miner-extract.ts")) {
  main().catch(fail);
}
