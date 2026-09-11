// winnerScore: recompute the longevity ranking for every CompetitorAd. Pure
// arithmetic on provider metrics — no model call, safe to run any time.
//
//   npm run miner:score
//   npm run miner:score -- --brand onecompress.com

import { refreshWinnerScores } from "../src/lib/cellumove/corpus/winner-score.server";
import { WINNER_SCORE_LABEL } from "../src/lib/cellumove/corpus/winner-score";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const result = await refreshWinnerScores({ brand: args.brand ?? undefined });
  console.log(`Scored ${result.scored} ads · ${result.updated} updated.`);
  console.log(WINNER_SCORE_LABEL);
}

main().catch(fail);
