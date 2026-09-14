import "server-only";

import { ScorerLayerSchema, type ScorerLayer } from "@/lib/cellumove/script-scorer";
import type { CopyTaxonomyCodeRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import type { TaxonomyEntry } from "./extract";

export type LoadedTaxonomy = {
  version: string;
  entries: TaxonomyEntry[];
  allowedCodes: Map<string, ScorerLayer>;
};

/** The closed enum the extractor selects from. Throws when the version is unseeded. */
export async function loadTaxonomy(version: string): Promise<LoadedTaxonomy> {
  const result = await supabase.from("CopyTaxonomyCode").select("*").eq("version", version).order("layer").order("code");
  if (result.error) throw new Error(`Could not load taxonomy ${version}: ${result.error.message}`);
  const rows = (result.data ?? []) as CopyTaxonomyCodeRow[];
  if (!rows.length) throw new Error(`Taxonomy ${version} has no codes. Seed it with: npm run miner:seed-taxonomy -- --version ${version} --commit`);
  const allowedCodes = new Map<string, ScorerLayer>();
  const entries: TaxonomyEntry[] = [];
  for (const row of rows) {
    const layer = ScorerLayerSchema.parse(row.layer);
    allowedCodes.set(row.code, layer);
    entries.push({ code: row.code, layer, label: row.label, description: row.description });
  }
  return { version, entries, allowedCodes };
}
