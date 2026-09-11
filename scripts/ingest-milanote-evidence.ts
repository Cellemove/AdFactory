import { enrichAllMilanoteEvidence } from "../src/lib/cellumove/milanote-enrichment.server";

async function main() {
  const persist = !process.argv.includes("--dry-run");
  const summary = await enrichAllMilanoteEvidence({ persist });
  console.log(JSON.stringify(summary, null, 2));
  if (!persist) console.log("Dry run only; no evidence or enrichment jobs were changed.");
  if (summary.jobsFailed || summary.recordsNeedsReview) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
