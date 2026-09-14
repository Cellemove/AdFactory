// Gate 1: run the production extractor BLIND over the hand-decomposed gold set
// and measure beat-level agreement. The corpus extraction must not start until
// this passes (≥80% layer, ≥70% code). Every run is logged with its prompt
// version; a prompt change without a re-run is forbidden.
//
//   npm run miner:eval
//   npm run miner:eval -- --baseline gold-35-v2 --taxonomy copy-taxonomy-v2
//   npm run miner:eval -- --limit 5

import { GATE1_CODE_THRESHOLD, GATE1_LAYER_THRESHOLD } from "../src/lib/cellumove/corpus/constants";
import { runGate1Eval } from "../src/lib/cellumove/corpus/eval.server";
import { fail, parseMinerArgs, usd } from "./lib/miner-cli";

const pct = (value: number | null) => (value == null ? "—" : value.toFixed(2));

async function main() {
  const args = parseMinerArgs();
  const result = await runGate1Eval({
    baselineVersion: args.baseline ?? undefined,
    taxonomyVersion: args.taxonomy ?? undefined,
    limit: args.limit ?? undefined,
    externalIds: args.ads.length ? args.ads : undefined,
    onProgress: (ad) => {
      if (ad.quarantined) console.log(`✗  ${ad.externalId} — quarantined: ${ad.error?.slice(0, 140) ?? ""}`);
      else console.log(`✓  ${ad.externalId} — layer ${pct(ad.comparison!.layerAgreement)} · code ${pct(ad.comparison!.codeAgreement)} · order ${pct(ad.comparison!.orderAgreement)}`);
    },
  });
  if (result.status === "no_gold") {
    console.log(`No gold ads for baseline ${result.baselineVersion} under taxonomy ${result.taxonomyVersion}.`);
    console.log("Import the hand decompositions first: npm run scorer:import-gold -- <normalized.json> --taxonomy <version> --baseline <version> --commit");
    process.exitCode = 2;
    return;
  }
  const { run, summary, passed, usage } = result;
  console.log(`\nGate 1 · baseline ${run.baselineVersion} · taxonomy ${run.taxonomyVersion} · prompt ${run.extractorPromptVersion} · model ${run.model}`);
  console.log(`ads ${summary.goldAdCount} · quarantined ${summary.quarantined}`);
  console.log(`layer agreement ${pct(summary.layerAgreement)}  (threshold ${GATE1_LAYER_THRESHOLD})  ${(summary.layerAgreement ?? 0) >= GATE1_LAYER_THRESHOLD ? "PASS" : "FAIL"}`);
  console.log(`code agreement  ${pct(summary.codeAgreement)}  (threshold ${GATE1_CODE_THRESHOLD})  ${(summary.codeAgreement ?? 0) >= GATE1_CODE_THRESHOLD ? "PASS" : "FAIL"}`);
  console.log(`order agreement ${pct(summary.orderAgreement)}`);
  if (summary.worst.length) console.log(`worst ads: ${summary.worst.map((ad) => `${ad.externalId} (layer ${pct(ad.layerAgreement)}, code ${pct(ad.codeAgreement)})`).join(", ")}`);
  const confusion = Object.entries(summary.confusion).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (confusion.length) console.log(`confusion (gold→pred): ${confusion.map(([key, count]) => `${key} ${count}`).join(", ")}`);
  console.log(`est. cost ${usd(usage?.estimatedCostUsd)} · logged as CorpusEvalRun ${run.id}`);
  console.log(passed ? "\nResult: PASS — miner:extract may run on the corpus." : "\nResult: FAIL — do not run miner:extract on the corpus until both thresholds are met (iterate the prompt, bump CORPUS_EXTRACT_PROMPT_VERSION, re-run).");
  if (!passed) process.exitCode = 1;
}

main().catch(fail);
