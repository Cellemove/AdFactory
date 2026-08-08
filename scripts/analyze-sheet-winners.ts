// Batch-analyze imported sheet winners: for the top N un-analyzed ads by spend,
// fetch each ad's FB post, persist the creative, and extract headline / visual /
// hook via Gemini — same core the /winners "✨ analyze" button uses.
//
// Tuned for LARGE runs: 3 concurrent lanes, and enrichments are flushed to the
// DB every 10 ads (the winners doc is multi-MB; saving per-ad would double the
// runtime in DB churn). An interrupted run loses at most the unflushed handful —
// re-running skips everything already saved.
//
// Run: npx tsx --env-file=.env scripts/analyze-sheet-winners.ts [limit]

import { supabase } from "../src/lib/db";
import { extractWinnerEnrichment } from "../src/lib/cellumove/sheet-winner-enrich";
import {
  sheetWinnerKey,
  type SheetWinnersDoc,
  type SheetWinnerEnrichment,
} from "../src/lib/cellumove/sheet-winners";

const RESEARCH_TYPE = "sheet_winners";
const CONCURRENCY = 3;
const FLUSH_EVERY = 10;

async function loadRow(): Promise<{ id: string; doc: SheetWinnersDoc }> {
  const res = await supabase
    .from("Research")
    .select("id, drafts")
    .eq("type", RESEARCH_TYPE)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("No imported winners — run scripts/import-sheet-winners.ts first.");
  const row = res.data as { id: string; drafts: string };
  return { id: row.id, doc: JSON.parse(row.drafts) as SheetWinnersDoc };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = Math.max(1, parseInt(process.argv[2] ?? "50", 10) || 50);
  const { doc } = await loadRow();
  // Doc is sorted by spend desc already; take the biggest un-analyzed bets.
  const pending = doc.winners.filter((w) => !w.enrichment && w.postLink).slice(0, limit);
  const already = doc.winners.filter((w) => w.enrichment).length;
  console.log(
    `${doc.winners.length} winners · ${already} already analyzed · analyzing next ${pending.length} by spend · ${CONCURRENCY} lanes\n`,
  );

  let ok = 0;
  let failed = 0;
  let done = 0;
  const hookCounts: Record<string, number> = {};
  const buffer = new Map<string, SheetWinnerEnrichment>();

  // Flush buffered enrichments onto the FRESHEST doc (so UI-click enrichments
  // landing mid-run are preserved), then save once.
  let flushChain: Promise<void> = Promise.resolve();
  const flush = (force = false) => {
    flushChain = flushChain.then(async () => {
      if (buffer.size === 0 || (!force && buffer.size < FLUSH_EVERY)) return;
      const entries = [...buffer.entries()];
      buffer.clear();
      const fresh = await loadRow();
      let touched = 0;
      for (const [key, e] of entries) {
        const target = fresh.doc.winners.find((x) => sheetWinnerKey(x) === key);
        if (target && !target.enrichment) {
          target.enrichment = e;
          touched++;
        }
      }
      if (touched > 0) {
        const upd = await supabase.from("Research").update({ drafts: JSON.stringify(fresh.doc) }).eq("id", fresh.id);
        if (upd.error) throw new Error(upd.error.message);
        console.log(`    — flushed ${touched} to DB (${ok} ok / ${failed} failed so far)`);
      }
    });
    return flushChain;
  };

  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= pending.length) return;
      const w = pending[i]!;
      const key = sheetWinnerKey(w);
      try {
        const e = await extractWinnerEnrichment(w);
        buffer.set(key, e);
        ok++;
        hookCounts[e.hookType || "?"] = (hookCounts[e.hookType || "?"] ?? 0) + 1;
        console.log(
          `[${i + 1}/${pending.length}] ✓ ${w.market} · ${w.adName.slice(0, 40)} · ${e.adType} · ${e.hookType || "?"} · "${(e.headline || e.primaryText).slice(0, 60)}"`,
        );
      } catch (err) {
        failed++;
        console.log(`[${i + 1}/${pending.length}] ✗ ${w.market} · ${w.adName.slice(0, 40)} · ${err instanceof Error ? err.message.slice(0, 80) : err}`);
      }
      done++;
      if (buffer.size >= FLUSH_EVERY) await flush();
      await sleep(500); // per-lane politeness to FB
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await flush(true);

  console.log(`\nDone: ${ok} analyzed, ${failed} failed (dead/private posts stay pending and can be retried).`);
  console.log("Hook types this run:");
  for (const [k, v] of Object.entries(hookCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);

  const final = await loadRow();
  console.log(`\nTotal analyzed in library: ${final.doc.winners.filter((w) => w.enrichment).length}/${final.doc.winners.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
