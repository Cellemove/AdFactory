// Headless b-roll analysis runner — loops analyzeBroll() until the library is
// fully analyzed. Same code path as the /broll button, no browser tab needed.
// Run:  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env scripts/analyze-broll-runner.ts [--once]
// (react-server condition neutralizes drive.ts's `import "server-only"` guard.)

import { analyzeBroll } from "../src/app/actions/broll";
import { supabase } from "../src/lib/db";

const once = process.argv.includes("--once");
const BATCH = 8;

const ts = () => new Date().toISOString().slice(11, 19);

async function remainingCount(): Promise<number> {
  const r = await supabase
    .from("BrollClip")
    .select("id", { head: true, count: "exact" })
    .is("analyzedAt", null);
  return r.count ?? -1;
}

async function main() {
  let lastRemaining = await remainingCount();
  console.log(`${ts()} start — ${lastRemaining} clips to analyze (batch ${BATCH})`);
  let noProgress = 0;

  for (let batch = 1; ; batch++) {
    let res: Awaited<ReturnType<typeof analyzeBroll>> | null = null;
    try {
      res = await analyzeBroll(BATCH);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      // revalidatePath throws outside the Next runtime AFTER the batch's real
      // work is done — not a failure. Anything else is a real batch error.
      if (!/revalidatePath|static generation|invariant/i.test(msg)) {
        console.log(`${ts()} batch ${batch} error: ${msg.slice(0, 200)}`);
      }
    }
    const remaining = res?.remaining ?? (await remainingCount());
    const stats = res
      ? `analyzed ${res.analyzed}, skipped ${res.skipped}, failed ${res.failed}` +
        (res.lastError ? `, lastErr: ${res.lastError.slice(0, 120)}` : "")
      : "(stats unavailable)";
    console.log(`${ts()} batch ${batch}: ${stats} — remaining ${remaining}`);

    if (remaining === 0) {
      console.log(`${ts()} ALL DONE`);
      process.exit(0);
    }
    if (once) {
      console.log(`${ts()} --once: stopping after one batch`);
      process.exit(0);
    }
    // Stall guard: remaining must trend down; 6 flat batches in a row = stuck.
    noProgress = remaining >= lastRemaining ? noProgress + 1 : 0;
    lastRemaining = remaining;
    if (noProgress >= 6) {
      console.log(`${ts()} STALLED — remaining stuck at ${remaining} for 6 batches, stopping`);
      process.exit(1);
    }
    if (noProgress > 0) await new Promise((r) => setTimeout(r, 10_000)); // back off when struggling
  }
}

main().catch((e) => {
  console.log(`${ts()} FATAL ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
  process.exit(1);
});
