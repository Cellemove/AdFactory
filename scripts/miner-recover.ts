// Restore only complete, validated results incorrectly marked failed by a duplicate writer.
import { supabase } from "../src/lib/db";
import { segmentId, beatId } from "../src/lib/cellumove/corpus/ids";
import { normalizeTranscript, TranscriptResponseSchema } from "../src/lib/cellumove/corpus/transcribe";
import { validateExtractedBeats } from "../src/lib/cellumove/corpus/extract";
import { loadTaxonomy } from "../src/lib/cellumove/corpus/taxonomy.server";
import { loadTranscriptSegments } from "../src/lib/cellumove/corpus/transcribe.server";
import { loadAdBeats } from "../src/lib/cellumove/corpus/extract.server";
import type { SegmentChannel } from "../src/lib/cellumove/corpus/constants";

async function main() {
  const brand = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!brand) throw new Error("Usage: miner-recover.ts <brand> [--apply]");
  const ads = await supabase.from("CompetitorAd").select("id").eq("brandName", brand).eq("corpusIncluded", true);
  if (ads.error) throw new Error(ads.error.message);
  const ids = (ads.data ?? []).map(ad => ad.id);
  if (!ids.length) throw new Error("No included ads for this brand.");
  let transcripts = 0;
  let extracts = 0;
  const rejected: Array<{ id: string; reason: string }> = [];
  const runs = await supabase.from("CorpusTranscriptRun").select("*").in("competitorAdId", ids).eq("status", "failed").like("errorSummary", "%CorpusTranscriptSegment_pkey%");
  if (runs.error) throw new Error(runs.error.message);
  for (const run of runs.data ?? []) {
    try {
      const saved = await loadTranscriptSegments(run.id);
      if (!run.durationSec || !run.segmentCount || saved.length !== run.segmentCount) throw new Error("Saved segment count or completion metadata is incomplete.");
      const transcript = normalizeTranscript(TranscriptResponseSchema.parse({ duration_sec: run.durationSec, language: run.language, segments: saved.map(segment => ({ channel: segment.channel, t_start: segment.tStart, t_end: segment.tEnd, text: segment.text, confidence: segment.confidence })) }));
      if (transcript.segments.length !== saved.length || transcript.durationSec !== run.durationSec) throw new Error("Saved transcript is incomplete or has an inconsistent duration.");
      for (const segment of saved) {
        if (segment.competitorAdId !== run.competitorAdId || segment.id !== segmentId(run.id, segment.channel, segment.orderIndex)) throw new Error("Segment provenance does not match this run.");
      }
      if (apply) {
        const updated = await supabase.from("CorpusTranscriptRun").update({ status: "complete", errorSummary: null })
          .eq("id", run.id).eq("status", "failed").eq("startedAt", run.startedAt).eq("completedAt", run.completedAt!).select("id");
        if (updated.error) throw new Error(updated.error.message);
        if (!updated.data.length) throw new Error("Run changed during recovery.");
      }
      transcripts += 1;
    } catch (error) { rejected.push({ id: run.id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  const extractionRuns = await supabase.from("CorpusExtractRun").select("*").in("competitorAdId", ids).eq("status", "failed").like("errorSummary", "%AdBeat_pkey%");
  if (extractionRuns.error) throw new Error(extractionRuns.error.message);
  for (const run of extractionRuns.data ?? []) {
    try {
      const [saved, segments, taxonomy, transcript] = await Promise.all([
        loadAdBeats(run.id), loadTranscriptSegments(run.transcriptRunId), loadTaxonomy(run.taxonomyVersion),
        supabase.from("CorpusTranscriptRun").select("durationSec").eq("id", run.transcriptRunId).single(),
      ]);
      if (transcript.error) throw new Error(transcript.error.message);
      if (!transcript.data.durationSec) throw new Error("Transcript duration is missing.");
      const validated = validateExtractedBeats({ raw: run.rawResponse, allowedCodes: taxonomy.allowedCodes, segments: segments.map(segment => ({ ...segment, channel: segment.channel as SegmentChannel })), transcriptEnd: transcript.data.durationSec });
      if (validated.beats.length !== saved.length) throw new Error("Saved beat count does not match the validated response.");
      for (const beat of validated.beats) {
        const row = saved.find(row => row.orderIndex === beat.orderIndex);
        if (!row || row.id !== beatId(run.id, beat.orderIndex) || row.competitorAdId !== run.competitorAdId || row.code !== beat.code || row.layer !== beat.layer || row.evidenceQuote !== beat.evidenceQuote || row.startSec !== beat.startSec || row.endSec !== beat.endSec || row.channel !== beat.channel || row.matchedSegmentId !== beat.matchedSegmentId) throw new Error("Saved beats differ from the validated response.");
      }
      if (apply) {
        const updated = await supabase.from("CorpusExtractRun").update({ status: "complete", errorCode: null, errorSummary: null })
          .eq("id", run.id).eq("status", "failed").eq("startedAt", run.startedAt).eq("completedAt", run.completedAt!).select("id");
        if (updated.error) throw new Error(updated.error.message);
        if (!updated.data.length) throw new Error("Run changed during recovery.");
      }
      extracts += 1;
    } catch (error) { rejected.push({ id: run.id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify({ brand, mode: apply ? "recovered" : "dry-run", transcripts, extracts, rejected }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
