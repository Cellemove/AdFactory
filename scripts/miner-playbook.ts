// PLAYBOOK: build one competitor's playbook from its extracted ads — spine,
// hooks, beats, formats, concepts and copywriting rules, every one with real
// quotes — and store a snapshot. Free: statistics only, no model call.
//
//   npm run miner:playbook -- --brand getionix.com

import { buildAndSavePlaybook } from "../src/lib/cellumove/corpus/playbook.server";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  if (!args.brand) throw new Error("Usage: npm run miner:playbook -- --brand <competitor domain>");
  const result = await buildAndSavePlaybook(args.brand, { mode: args.mode });
  if (!result.playbook) {
    console.log(`No extracted ads for ${args.brand} yet - run the pipeline first.`);
    return;
  }
  const p = result.playbook;
  console.log(`Playbook for ${p.brand}: ${p.adCount} ads (${result.written ? "new snapshot" : "unchanged"})`);
  if (p.spine) console.log(`Spine (${p.spine.ads} ads): ${p.spine.steps.map((step) => step.label).join(" -> ")}`);
  console.log(`Hooks: ${p.hooks.map((hook) => `${hook.label} ${Math.round(hook.share * 100)}%`).join(" | ")}`);
  console.log(`Formats: ${p.formats.map((row) => `${row.name} ${Math.round(row.share * 100)}%`).join(" | ")}`);
  console.log(`Concepts: ${p.concepts.map((row) => `${row.name} ${Math.round(row.share * 100)}%`).join(" | ")}`);
  console.log("Copy rules:");
  for (const rule of p.copy.rules) console.log(`  ${Math.round(rule.share * 100).toString().padStart(3)}%  ${rule.rule}  e.g. "${rule.examples[0]?.text ?? ""}"`);
  for (const caveat of p.caveats) console.log(`! ${caveat}`);
}

main().catch(fail);
