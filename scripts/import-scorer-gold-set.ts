import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateGoldSetImport } from "../src/lib/cellumove/gold-set-import";
import { SCORER_BASELINE_VERSION as DEFAULT_BASELINE_VERSION, SCORER_TAXONOMY_VERSION as DEFAULT_TAXONOMY_VERSION } from "../src/lib/cellumove/script-scorer";
import { ScorerLayerSchema } from "../src/lib/cellumove/script-scorer";
import type { CopyTaxonomyCodeRow } from "../src/lib/database.types";
import { newId, supabase } from "../src/lib/db";

/** `--name value` or `--name=value`; null when absent. */
function flagValue(args: string[], name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  // Overrides so the Corpus Miner's Gate 1 can import the hand decompositions
  // under a newer taxonomy/baseline (e.g. copy-taxonomy-v2 / gold-35-v2).
  const SCORER_TAXONOMY_VERSION = flagValue(args, "taxonomy") ?? DEFAULT_TAXONOMY_VERSION;
  const SCORER_BASELINE_VERSION = flagValue(args, "baseline") ?? DEFAULT_BASELINE_VERSION;
  const consumed = new Set([flagValue(args, "taxonomy"), flagValue(args, "baseline")].filter(Boolean));
  const fileArg = args.find((arg) => !arg.startsWith("--") && !consumed.has(arg));
  if (!fileArg) throw new Error("Usage: npm run scorer:import-gold -- <normalized.json> [--commit] [--taxonomy <version>] [--baseline <version>]");
  const filePath = path.resolve(process.cwd(), fileArg);
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const taxonomyResult = await supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION);
  if (taxonomyResult.error) throw new Error(`Could not load scorer taxonomy: ${taxonomyResult.error.message}`);
  const codes = new Map(((taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[]).map((row) => [row.code, ScorerLayerSchema.parse(row.layer)] as const));
  const report = validateGoldSetImport(raw, codes);
  console.log(JSON.stringify({ file: filePath, mode: commit ? "commit" : "dry-run", accepted: report.accepted.length, rejected: report.rejected }, null, 2));
  if (report.rejected.length) throw new Error("Gold-set validation failed; no rows were written.");
  if (!commit) return;
  for (const ad of report.accepted) {
    const existing = await supabase.from("GoldAd").select("id").eq("baselineVersion", SCORER_BASELINE_VERSION).eq("externalId", ad.externalId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const adId = existing.data?.id ?? newId();
    const adWrite = await supabase.from("GoldAd").upsert({
      id: adId,
      externalId: ad.externalId,
      title: ad.title,
      angleSlug: ad.angleSlug,
      format: ad.format,
      marketCode: ad.marketCode?.toUpperCase() ?? null,
      durationSec: ad.durationSec ?? null,
      scriptText: ad.scriptText,
      baselineVersion: SCORER_BASELINE_VERSION,
      taxonomyVersion: SCORER_TAXONOMY_VERSION,
    }, { onConflict: "baselineVersion,externalId" });
    if (adWrite.error) throw new Error(adWrite.error.message);
    const beatRows = ad.beats.map((beat) => ({
      id: `gb_${createHash("sha256").update(`${SCORER_BASELINE_VERSION}:${ad.externalId}:${beat.orderIndex}`).digest("hex").slice(0, 24)}`,
      goldAdId: adId, taxonomyVersion: SCORER_TAXONOMY_VERSION, orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code,
      startSec: beat.startSec ?? null, endSec: beat.endSec ?? null, evidenceQuote: beat.evidenceQuote,
      otherExplanation: beat.otherExplanation ?? null,
    }));
    const beatWrite = await supabase.from("GoldBeat").upsert(beatRows, { onConflict: "goldAdId,orderIndex" });
    if (beatWrite.error) throw new Error(beatWrite.error.message);
    const existingBeats = await supabase.from("GoldBeat").select("id").eq("goldAdId", adId);
    if (existingBeats.error) throw new Error(existingBeats.error.message);
    const activeIds = new Set(beatRows.map((beat) => beat.id));
    const staleIds = (existingBeats.data ?? []).map((beat) => beat.id).filter((id) => !activeIds.has(id));
    if (staleIds.length) {
      const removeStale = await supabase.from("GoldBeat").delete().in("id", staleIds);
      if (removeStale.error) throw new Error(removeStale.error.message);
    }
  }
  console.log(`Committed ${report.accepted.length} gold ads to baseline ${SCORER_BASELINE_VERSION}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
