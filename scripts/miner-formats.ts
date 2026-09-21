// Publish reference formats measured from the Corpus Miner's winning ads.
//
//   npm run miner:formats              print what would be published (writes nothing)
//   npm run miner:formats -- --write   create / refresh the formats in Knowledge → Reference formats
//
// Safe to re-run: formats are keyed by slug ("winners-…"), so a later run with more
// broken-down ads updates the same rows instead of piling up copies. Hand-made and
// seeded formats are never touched.

import { CORPUS_TAXONOMY_VERSION } from "../src/lib/cellumove/corpus/constants";
import { deriveWinnerFormats, WINNER_FORMATS_VERSION, type WinnerFormatAd, type WinnerFormatTaxonomy } from "../src/lib/cellumove/corpus/winner-formats";
import type { AdBeatRow, CompetitorAdRow, CorpusExtractRunRow } from "../src/lib/database.types";
import { newId, supabase } from "../src/lib/db";

async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await fetchPage(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function main() {
  const write = process.argv.includes("--write");
  const runs = await pages<CorpusExtractRunRow>((from, to) => supabase.from("CorpusExtractRun").select("*").eq("taxonomyVersion", CORPUS_TAXONOMY_VERSION).eq("researchMode", "full_video").eq("status", "complete").order("createdAt", { ascending: false }).range(from, to));
  // ponytail: full-video runs only, so a newer speech-only run never replaces an ad's
  // full breakdown here. Derive a separate speech set when that corpus reaches cohort size.
  const latest = new Map<string, string>();
  for (const run of runs) if (!latest.has(run.competitorAdId)) latest.set(run.competitorAdId, run.id);
  const runIds = new Set(latest.values());
  const [beats, ads, taxonomy] = await Promise.all([
    pages<AdBeatRow>((from, to) => supabase.from("AdBeat").select("*").eq("taxonomyVersion", CORPUS_TAXONOMY_VERSION).order("id").range(from, to)),
    pages<CompetitorAdRow>((from, to) => supabase.from("CompetitorAd").select("*").eq("corpusIncluded", true).order("id").range(from, to)),
    pages<WinnerFormatTaxonomy>((from, to) => supabase.from("CopyTaxonomyCode").select("code,layer,label,description").eq("version", CORPUS_TAXONOMY_VERSION).order("code").range(from, to)),
  ]);
  const winners: WinnerFormatAd[] = ads.filter((ad) => latest.has(ad.id)).map((ad) => ({
    id: ad.id, brand: ad.brandName, formatTag: ad.formatTag ?? null, conceptTag: ad.angleTag ?? null, winnerScore: ad.winnerScore ?? null,
    beats: beats.filter((beat) => beat.runId === latest.get(ad.id) && runIds.has(beat.runId)).map((beat) => ({ code: beat.code, layer: beat.layer, orderIndex: beat.orderIndex, startSec: beat.startSec, endSec: beat.endSec, quote: beat.evidenceQuote })),
  }));

  const formats = deriveWinnerFormats(winners, taxonomy);
  console.log(`${winners.length} broken-down winning ads → ${formats.length} formats (${WINNER_FORMATS_VERSION})${write ? "" : " · DRY RUN, nothing written"}\n`);
  for (const format of formats) {
    console.log(`${format.name}  ·  ~${format.optimalDurationSec}s  ·  ${format.adCount} ads`);
    console.log(`  ${format.description}`);
    for (const beat of format.beats) console.log(`    ${beat.time.padEnd(8)} ${beat.label}`);
    console.log("");
  }
  if (!write) return;

  const now = new Date().toISOString();
  for (const [index, format] of formats.entries()) {
    const fields = {
      name: format.name, description: format.description, beats: JSON.stringify(format.beats), bestForAngle: format.bestForAngle,
      optimalDurationSec: format.optimalDurationSec, exampleScripts: JSON.stringify(format.exampleScripts),
      sourceKind: "corpus", sourceUrl: null, sourceLabel: `${format.adCount} winning ads · ${WINNER_FORMATS_VERSION}`, updatedAt: now,
    };
    const existing = await supabase.from("ReferenceFormat").select("id").eq("slug", format.slug).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const result = existing.data
      ? await supabase.from("ReferenceFormat").update(fields).eq("id", existing.data.id)
      : await supabase.from("ReferenceFormat").insert({ id: newId(), slug: format.slug, order: 200 + index, createdAt: now, ...fields });
    if (result.error) throw new Error(`${format.name}: ${result.error.message}`);
    console.log(`${existing.data ? "updated" : "created"}  ${format.name}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
