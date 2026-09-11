// Taxonomy seeds for "CopyTaxonomyCode". Seeded by scripts/seed-copy-taxonomy.ts.
//
// Rules (spec §4): the model selects from a CLOSED enum and never invents;
// every layer has an OTHER code with mandatory free text; a taxonomy is never
// mutated in place — changes are a new version, or old beats stop being
// interpretable. Seeds live in a .ts file because .gitignore drops
// *-*-*.json files.
//
// copy-taxonomy-v1 already exists in the database (migration 015) with nine
// generic codes; it is the placeholder the corpus runs against today.
//
// copy-taxonomy-v2 is the hand-built list from the manual 35-ad teardown
// (H1..H17 plus the Q/P/B/M/PR/O codes). It is NOT in this repository yet.
// Fill in the array below from the teardown document, then:
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2           (dry run, prints the diff)
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2 --commit
//   set CORPUS_TAXONOMY_VERSION=copy-taxonomy-v2 in .env
// The seed script appends the per-layer OTHER codes automatically.

import type { ScorerLayer } from "@/lib/cellumove/script-scorer";

export type TaxonomySeed = {
  code: string;
  layer: ScorerLayer;
  label: string;
  description: string;
};

export const TAXONOMY_LAYERS: Array<{ layer: Exclude<ScorerLayer, "OTHER">; name: string }> = [
  { layer: "H", name: "Hook" },
  { layer: "Q", name: "Qualify" },
  { layer: "P", name: "Pain" },
  { layer: "B", name: "Belief" },
  { layer: "M", name: "Mechanism" },
  { layer: "PR", name: "Proof" },
  { layer: "O", name: "Offer" },
];

/** One OTHER code per layer (H_OTHER, Q_OTHER, …) plus the global OTHER. */
export function perLayerOtherCodes(): TaxonomySeed[] {
  return [
    ...TAXONOMY_LAYERS.map(({ layer, name }) => ({
      code: `${layer}_OTHER`,
      layer,
      label: `Other ${name.toLowerCase()} beat`,
      description: `A ${name.toLowerCase()}-layer beat that fits none of the named ${name.toLowerCase()} codes. other_explanation is mandatory; recurring explanations are promoted to real codes in the next taxonomy version.`,
    })),
    { code: "OTHER", layer: "OTHER", label: "Other", description: "A deliberate beat that belongs to no layer. other_explanation is mandatory." },
  ];
}

export const TAXONOMY_SEEDS: Record<string, TaxonomySeed[]> = {
  // Expected shape for the hand-built list. Codes: H_01..H_17 (or the teardown's
  // own identifiers), then Q_*, P_*, B_*, M_*, PR_*, O_*. Keep the teardown's
  // definitions verbatim in `description` — the extractor reads them.
  //
  // { code: "H_01", layer: "H", label: "<teardown name>", description: "<teardown definition>" },
  // { code: "Q_01", layer: "Q", label: "…", description: "…" },
  "copy-taxonomy-v2": [],
};
