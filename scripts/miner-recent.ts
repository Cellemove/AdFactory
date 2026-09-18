import { runRecentWinners } from "../src/lib/cellumove/corpus/runner.server";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const result = await runRecentWinners({ cap: args.limit ?? undefined, dryRun: args.dryRun });
  console.log(`${result.reason} · ${result.submittedToday}/${result.cap} already submitted today`);
  for (const ad of result.candidates) console.log(`${ad.brand} · launched ${ad.startedAt} · ${ad.adId}`);
  console.log(`BrandSearch credits used: ${result.creditsUsed} · daily remaining ${result.dailyRemaining ?? "not queried"} · monthly remaining ${result.monthlyRemaining ?? "not queried"}`);
  if (result.results.some((row) => row.outcome === "failed")) process.exitCode = 1;
}

main().catch(fail);
