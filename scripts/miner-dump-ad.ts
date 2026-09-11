// The first deliverable: ONE competitor ad, fully decomposed end to end by the
// pipeline, as a single JSON document — every beat with a valid evidence quote
// and timecode, no manual editing. Compare it against the hand-built
// decomposition of the same ad before trusting the other 799.
//
//   npm run miner:dump-ad -- cad_…
//   npm run miner:dump-ad -- cad_… --run-missing          (download / transcribe / extract first)
//   npm run miner:dump-ad -- cad_… --out corpus-media/first-ad.json

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CORPUS_TAXONOMY_VERSION } from "../src/lib/cellumove/corpus/constants";
import { dumpAdJson } from "../src/lib/cellumove/corpus/dump.server";
import { extractAdBeats } from "../src/lib/cellumove/corpus/extract.server";
import { downloadAdMedia, loadAdMedia } from "../src/lib/cellumove/corpus/media.server";
import { loadCompetitorAds } from "../src/lib/cellumove/corpus/state.server";
import { latestCompleteTranscriptRun, transcribeAd } from "../src/lib/cellumove/corpus/transcribe.server";
import { fail, parseMinerArgs } from "./lib/miner-cli";

async function main() {
  const args = parseMinerArgs();
  const adId = args.positional[0] ?? args.ads[0];
  if (!adId) throw new Error("Usage: npm run miner:dump-ad -- <competitorAdId> [--run-missing] [--with-video] [--out file.json]");

  if (args.runMissing) {
    const [ad] = await loadCompetitorAds({ ids: [adId] });
    if (!ad) throw new Error(`No CompetitorAd with id ${adId}.`);
    console.error(`▶ media`);
    const media = await downloadAdMedia(ad, { force: args.force });
    if (media.status !== "downloaded") throw new Error(`Media ${media.status}: ${media.statusReason ?? ""}`);
    console.error(`▶ transcribe`);
    const transcript = await transcribeAd(ad, media, { force: args.force });
    console.error(`  ${transcript.reused ? "reused" : "new"} · ${transcript.segments.length} segments`);
    console.error(`▶ extract (Gate 1 is not enforced for a single-ad dump)`);
    const transcriptRun = transcript.run.status === "complete" ? transcript.run : await latestCompleteTranscriptRun(ad.id);
    if (!transcriptRun) throw new Error("No complete transcript.");
    const extracted = await extractAdBeats(ad, transcriptRun, { force: args.force, retryReview: true, withVideo: args.withVideo, media, taxonomyVersion: args.taxonomy ?? CORPUS_TAXONOMY_VERSION });
    console.error(`  ${extracted.run.status} · ${extracted.beats.length} beats`);
  }

  const dump = await dumpAdJson(adId);
  if (!dump) throw new Error(`No CompetitorAd with id ${adId}.`);
  const json = JSON.stringify(dump, null, 2);
  if (args.out) {
    const target = path.resolve(process.cwd(), args.out);
    await writeFile(target, json, "utf8");
    console.error(`Wrote ${target}`);
  } else {
    console.log(json);
  }
}

main().catch(fail);
