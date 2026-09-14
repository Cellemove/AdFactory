// TEARDOWN: send the corpus winners to the Teardown service (14-part winning-ad
// workbook, Gemini on Vertex) and mirror each result into AdTeardown. Winners
// are the top quartile by winnerScore, recomputed first. A qualitative read for
// strategists — it never feeds MINE. Teardown also appends its Google Sheet row.
//
//   npm run miner:teardown -- --dry-run          (who would be sent, est. cost)
//   npm run miner:teardown                       (top quartile, wait for results)
//   npm run miner:teardown -- --limit 20         (top 20 instead)
//   npm run miner:teardown -- --ad cad_… --force (re-run one ad)
//   npm run miner:teardown -- --no-wait          (submit only; a later run collects)
//
// Already-completed ads are skipped unless --force; failed ones are retried.

import { loadCorpusState, loadCompetitorAds } from "../src/lib/cellumove/corpus/state.server";
import { planTeardown } from "../src/lib/cellumove/corpus/queue";
import { isTerminal, TEARDOWN_TYPICAL_COST_USD, teardownCostUsd, teardownSourceFor } from "../src/lib/cellumove/corpus/teardown";
import { loadAdTeardowns, submitAdTeardown, syncAdTeardown } from "../src/lib/cellumove/corpus/teardown.server";
import { loadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { refreshWinnerScores } from "../src/lib/cellumove/corpus/winner-score.server";
import type { AdTeardownRow } from "../src/lib/database.types";
import { fail, parseMinerArgs, printSummary, runLanes, usd } from "./lib/miner-cli";

const POLL_MS = 20_000;
const WAIT_LIMIT_MS = 45 * 60_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForResults(ids: string[]): Promise<AdTeardownRow[]> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let rows = await loadAdTeardowns({ ids });
  const seen = new Map(rows.map((row) => [row.competitorAdId, row.status]));
  while (rows.some((row) => !isTerminal(row.status))) {
    if (Date.now() > deadline) {
      console.log(`\nStopped waiting after ${WAIT_LIMIT_MS / 60_000} min; re-run to collect the rest.`);
      break;
    }
    await pause(POLL_MS);
    rows = await Promise.all(rows.map(async (row) => {
      if (isTerminal(row.status)) return row;
      try {
        return await syncAdTeardown(row);
      } catch (error) {
        console.error(`   poll ${row.competitorAdId}: ${error instanceof Error ? error.message : String(error)}`);
        return row;
      }
    }));
    for (const row of rows) {
      if (seen.get(row.competitorAdId) === row.status) continue;
      seen.set(row.competitorAdId, row.status);
      const note = row.status === "failed" ? ` — ${row.errorCode}: ${row.errorMessage ?? ""}` : row.status === "completed" ? ` — ${usd(teardownCostUsd(row))}` : "";
      console.log(`   ${row.competitorAdId} → ${row.status}${note}`);
    }
  }
  return rows;
}

async function main() {
  const args = parseMinerArgs();
  const noWait = process.argv.includes("--no-wait");

  const scoring = await refreshWinnerScores();
  const state = await loadCorpusState();
  const teardowns = await loadAdTeardowns();
  const { winners, todo, pending, scoredCount } = planTeardown(state.rows, teardowns, { force: args.force, ids: args.ads, brand: args.brand, limit: args.limit });
  if (!winners.length) {
    console.log(`No winners to tear down (${scoring.scored} ads scored, ${scoredCount} scored videos in scope).`);
    return;
  }

  const existing = new Map(teardowns.map((row) => [row.competitorAdId, row]));
  const ads = await loadCompetitorAds({ ids: winners.map((row) => row.id) });
  const adById = new Map(ads.map((ad) => [ad.id, ad]));
  const rank = new Map(winners.map((row, index) => [row.id, index + 1]));

  console.log(`Winners: top ${winners.length} of ${scoredCount} scored videos · ${todo.length} to send · ${pending.length} already in progress · ${winners.length - todo.length - pending.length} done.`);

  if (args.dryRun) {
    for (const row of winners) {
      const ad = adById.get(row.id);
      const source = ad ? teardownSourceFor(ad, await loadAdMedia(ad.id)) : null;
      const current = existing.get(row.id)?.status ?? "—";
      const action = todo.some((item) => item.id === row.id) ? "SEND" : "skip";
      console.log(`  #${String(rank.get(row.id)).padStart(2)} ${action}  ${row.winnerScore?.toFixed(0).padStart(3)}  ${row.brandName} · ${row.id}  [${source ? (source.kind === "url" ? source.sourceKind : "stored copy") : "NO SOURCE"}] teardown: ${current}`);
    }
    console.log(`\nDry run — nothing sent. Estimated ${usd(todo.length * TEARDOWN_TYPICAL_COST_USD)} (~${usd(TEARDOWN_TYPICAL_COST_USD)}/video on Gemini 2.5 Pro).`);
    return;
  }

  if (todo.length) {
    console.log(`Submitting ${todo.length} ad(s) on ${args.concurrency ?? 3} lanes…`);
    const summary = await runLanes(todo, args.concurrency ?? 3, (row) => `#${rank.get(row.id)} ${row.brandName} · ${row.id}`, async (row) => {
      const ad = adById.get(row.id);
      if (!ad) throw new Error("CompetitorAd row vanished.");
      const saved = await submitAdTeardown(ad, existing.get(row.id) ?? null);
      return `${saved.status} · ${saved.sourceKind} · teardown ${saved.teardownId}`;
    });
    printSummary("teardown submit", summary);
  }

  if (noWait) {
    console.log("Not waiting (--no-wait). Re-run miner:teardown later to collect results.");
    return;
  }

  const watch = winners.map((row) => row.id).filter((id) => existing.has(id) || todo.some((row) => row.id === id));
  console.log(`\nWaiting for Teardown (usually 2–4 min per video; polling every ${POLL_MS / 1000}s)…`);
  const rows = await waitForResults(watch);
  const completed = rows.filter((row) => row.status === "completed");
  const failedRows = rows.filter((row) => row.status === "failed");
  const cost = completed.reduce((sum, row) => sum + (teardownCostUsd(row) ?? 0), 0);
  console.log(`\nteardown: ${completed.length} completed · ${failedRows.length} failed · ${rows.length - completed.length - failedRows.length} still running · ${usd(cost)} estimated Gemini spend`);
  for (const row of failedRows) console.log(`  ✗ ${row.competitorAdId}: ${row.errorCode} ${row.errorMessage ?? ""}`);
  if (failedRows.length) process.exitCode = 1;
}

main().catch(fail);
