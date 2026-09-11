// MINE: statistics over every ad with a complete extraction — code frequency,
// positional laws, dominant spines, top-vs-bottom quartile lift, layer
// durations. One CorpusPatternReport snapshot per cohort; re-running on an
// unchanged corpus writes nothing.
//
//   npm run miner:mine
//   npm run miner:mine -- --min-support 3 --taxonomy copy-taxonomy-v2

import { mineAndSaveReports } from "../src/lib/cellumove/corpus/mine.server";
import { renderReportText } from "../src/lib/cellumove/corpus/report";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const result = await mineAndSaveReports({ taxonomyVersion: args.taxonomy ?? undefined, minSupport: args.minSupport ?? undefined });
  if (!result.all) {
    console.log("No ads with a complete extraction yet — run miner:extract first.");
    return;
  }
  console.log(renderReportText(result.all));
  console.log(`\nCohorts: ${result.cohorts.join(", ")}`);
  console.log(`${result.written} snapshot(s) written · ${result.unchanged} unchanged.`);
}

main().catch(fail);
