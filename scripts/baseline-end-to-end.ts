// Baseline the end-to-end time: idea -> shipped script.
//
// Drives one complete example through the real pipeline — product, angle,
// AI-researched avatar with profile, mined verbatims, framework, a generated
// script with hooks and B-roll, sent to and assigned to an editor — and times
// every stage. Prints a stage table and writes backups/baseline/<stamp>.json.
//
// Run: `npm run baseline:e2e`   (full chain, real AI, several minutes)
//
// With flags, call tsx directly — npm consumes some of them as its own config
// (`--dry-run` is one) and PowerShell drops the `--` separator, so they never
// reach argv:
//      `npx tsx --env-file=.env scripts/baseline-end-to-end.ts --help`
//
// This file stays deliberately thin. The stub install below must happen before
// anything from src/ is loaded, and tsx hoists static imports in source order —
// so the orchestration is behind a dynamic import rather than trusting an import
// list to keep its order through a future lint autofix.

import "./baseline/next-runtime-stubs";

void (async () => {
  const { main } = await import("./baseline/run");
  await main(process.argv.slice(2));
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
