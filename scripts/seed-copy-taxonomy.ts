// Seed a taxonomy version into CopyTaxonomyCode from taxonomy-seeds.ts.
// Never mutates an existing code: if the version already exists with different
// rows the script prints the diff and refuses. New versions get the per-layer
// OTHER codes appended automatically.
//
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2            (dry run)
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2 --commit

import { ScorerLayerSchema } from "../src/lib/cellumove/script-scorer";
import { TAXONOMY_SEEDS, perLayerOtherCodes, type TaxonomySeed } from "../src/lib/cellumove/corpus/taxonomy-seeds";
import type { CopyTaxonomyCodeRow } from "../src/lib/database.types";
import { supabase } from "../src/lib/db";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const version = args.version;
  if (!version) throw new Error("Usage: npm run miner:seed-taxonomy -- --version <copy-taxonomy-vN> [--commit]");
  const named = TAXONOMY_SEEDS[version];
  if (!named) throw new Error(`No seed named ${version} in src/lib/cellumove/corpus/taxonomy-seeds.ts (known: ${Object.keys(TAXONOMY_SEEDS).join(", ")}).`);
  if (!named.length) {
    throw new Error(`Seed ${version} is empty. Fill in the hand-built code list (H1..H17 and the Q/P/B/M/PR/O codes) in taxonomy-seeds.ts first — the taxonomy is never invented by the tool.`);
  }

  const byCode = new Map<string, TaxonomySeed>();
  for (const seed of [...named, ...perLayerOtherCodes()]) {
    ScorerLayerSchema.parse(seed.layer);
    if (!/^[A-Z][A-Z0-9_]*$/.test(seed.code)) throw new Error(`Code "${seed.code}" must be UPPER_SNAKE_CASE.`);
    if (byCode.has(seed.code)) throw new Error(`Duplicate code ${seed.code} in seed ${version}.`);
    byCode.set(seed.code, seed);
  }
  const seeds = [...byCode.values()];

  const existingResult = await supabase.from("CopyTaxonomyCode").select("*").eq("version", version);
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = new Map(((existingResult.data ?? []) as CopyTaxonomyCodeRow[]).map((row) => [row.code, row]));

  const toInsert: TaxonomySeed[] = [];
  const conflicts: string[] = [];
  for (const seed of seeds) {
    const row = existing.get(seed.code);
    if (!row) {
      toInsert.push(seed);
      continue;
    }
    if (row.layer !== seed.layer || row.label !== seed.label || row.description !== seed.description) {
      conflicts.push(`${seed.code}: db(${row.layer} · ${row.label}) ≠ seed(${seed.layer} · ${seed.label})`);
    }
  }
  const orphaned = [...existing.keys()].filter((code) => !byCode.has(code));

  console.log(`Taxonomy ${version}: ${seeds.length} codes in seed · ${existing.size} in database · ${toInsert.length} to insert`);
  for (const seed of toInsert) console.log(`  + ${seed.code} [${seed.layer}] ${seed.label}`);
  if (orphaned.length) console.log(`  (in database but not in seed, left untouched: ${orphaned.join(", ")})`);
  if (conflicts.length) {
    console.error(`\nRefusing: ${conflicts.length} code(s) already exist with different definitions. Taxonomies are never mutated in place — create a new version instead.`);
    for (const conflict of conflicts) console.error(`  ${conflict}`);
    process.exitCode = 1;
    return;
  }
  if (!args.commit) {
    console.log("\nDry run — pass --commit to write.");
    return;
  }
  if (!toInsert.length) {
    console.log("Nothing to insert.");
    return;
  }
  const write = await supabase.from("CopyTaxonomyCode").upsert(
    toInsert.map((seed) => ({ version, code: seed.code, layer: seed.layer, label: seed.label, description: seed.description })),
    { onConflict: "version,code", ignoreDuplicates: true },
  );
  if (write.error) throw new Error(write.error.message);
  console.log(`Inserted ${toInsert.length} code(s) into ${version}. Set CORPUS_TAXONOMY_VERSION=${version} to use it.`);
}

main().catch(fail);
