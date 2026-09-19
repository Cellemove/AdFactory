// Script bench: run the frozen briefs through the REAL generation path, score
// them with the existing scorer + workflow audit, and compare two runs.
//
//   npx tsx --env-file=.env scripts/bench.ts --label baseline
//   npx tsx --env-file=.env scripts/bench.ts --label flash-audit --judge-model gemini-2.5-flash
//   npx tsx --env-file=.env scripts/bench.ts --compare scripts/bench/results/a.json scripts/bench/results/b.json
//   npx tsx --env-file=.env scripts/bench.ts --help
//
// Thin on purpose, like baseline-end-to-end.ts: the Next runtime stubs must be
// installed before anything from src/ loads, so the work sits behind a dynamic import.

import "./baseline/next-runtime-stubs";

void (async () => {
  const { main } = await import("./baseline/bench");
  await main(process.argv.slice(2));
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
