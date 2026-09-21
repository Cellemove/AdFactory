// MINE: statistics over every ad with a complete extraction — code frequency,
// positional laws, dominant spines, top-vs-bottom quartile lift, layer
// durations. One CorpusPatternReport snapshot per cohort; re-running on an
// unchanged corpus writes nothing.
//
//   npm run miner:mine
//   npm run miner:mine -- --brand getionix.com     (writes the "all" + that brand's snapshot)
//   npm run miner:mine -- --min-support 3 --taxonomy copy-taxonomy-v2

import { mineAndSaveReports } from "../src/lib/cellumove/corpus/mine.server";
import { renderReportText } from "../src/lib/cellumove/corpus/report";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const result = await mineAndSaveReports({ mode: args.mode, brand: args.brand, taxonomyVersion: args.taxonomy ?? undefined, minSupport: args.minSupport ?? undefined });
  const report = args.brand ? result.brand : result.all;
  if (!report) {
    console.log("No ads with a complete extraction yet — run miner:extract first.");
    return;
  }
  console.log(renderReportText(report));
  console.log(`\nCohorts: ${result.cohorts.join(", ")}`);
  console.log(`${result.written} snapshot(s) written · ${result.unchanged} unchanged.`);
}

main().catch(fail);
