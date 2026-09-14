import "server-only";

import { SCORER_BASELINE_VERSION } from "@/lib/cellumove/script-scorer";
import type { CorpusEvalRunRow, GoldAdRow, GoldBeatRow, Json } from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";
import { CORPUS_ENGINE_VERSION, CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_TAXONOMY_VERSION, GATE1_CODE_THRESHOLD, GATE1_LAYER_THRESHOLD, USAGE_FEATURES } from "./constants";
import { compareBeats, goldToPseudoTranscript, summarizeEval, type EvalAdResult, type EvalSummary } from "./eval";
import { ExtractValidationError, buildExtractPrompt, validateExtractedBeats } from "./extract";
import { EXTRACT_MODEL } from "./extract.server";
import { addUsage, generateStructured, parseJsonObject, type UsageSummary } from "./llm-seam.server";
import { loadTaxonomy } from "./taxonomy.server";
import { renderTranscript } from "./transcribe";

export type Gate1Input = {
  baselineVersion?: string;
  taxonomyVersion?: string;
  limit?: number;
  externalIds?: string[];
  onProgress?: (result: EvalAdResult) => void;
};

export type Gate1Result =
  | { status: "no_gold"; baselineVersion: string; taxonomyVersion: string }
  | { status: "done"; run: CorpusEvalRunRow; summary: EvalSummary; passed: boolean; usage: UsageSummary | null; results: EvalAdResult[] };

/** Run the production extractor blind over the gold set and log the agreement. */
export async function runGate1Eval(input: Gate1Input = {}): Promise<Gate1Result> {
  const baselineVersion = input.baselineVersion ?? SCORER_BASELINE_VERSION;
  const taxonomyVersion = input.taxonomyVersion ?? CORPUS_TAXONOMY_VERSION;
  let query = supabase.from("GoldAd").select("*").eq("baselineVersion", baselineVersion).eq("taxonomyVersion", taxonomyVersion).order("externalId");
  if (input.externalIds?.length) query = query.in("externalId", input.externalIds);
  if (input.limit) query = query.limit(input.limit);
  const goldResult = await query;
  if (goldResult.error) throw new Error(goldResult.error.message);
  const goldAds = (goldResult.data ?? []) as GoldAdRow[];
  if (!goldAds.length) return { status: "no_gold", baselineVersion, taxonomyVersion };

  const beatsResult = await supabase.from("GoldBeat").select("*").in("goldAdId", goldAds.map((ad) => ad.id)).order("orderIndex");
  if (beatsResult.error) throw new Error(beatsResult.error.message);
  const goldBeats = (beatsResult.data ?? []) as GoldBeatRow[];
  const taxonomy = await loadTaxonomy(taxonomyVersion);

  let usage: UsageSummary | null = null;
  const results: EvalAdResult[] = [];
  for (const goldAd of goldAds) {
    const pseudo = goldToPseudoTranscript(goldAd.scriptText, goldAd.durationSec);
    const transcriptText = renderTranscript(pseudo.segments);
    let previousError: string | undefined;
    let attempts = 0;
    let comparison: EvalAdResult["comparison"] = null;
    let error: string | null = null;
    for (attempts = 1; attempts <= 2 && !comparison; attempts += 1) {
      try {
        const response = await generateStructured({
          model: EXTRACT_MODEL,
          parts: [{ text: buildExtractPrompt({ taxonomyVersion, taxonomy: taxonomy.entries, transcriptText, durationSec: pseudo.durationSec, language: null, previousError }) }],
          thinkingBudget: 2048,
          feature: USAGE_FEATURES.eval,
          metadata: { goldAdId: goldAd.id, externalId: goldAd.externalId, promptVersion: CORPUS_EXTRACT_PROMPT_VERSION, taxonomyVersion, attempt: attempts },
        });
        usage = addUsage(usage, response.usage);
        const validated = validateExtractedBeats({ raw: parseJsonObject(response.text), allowedCodes: taxonomy.allowedCodes, segments: pseudo.segments, transcriptEnd: pseudo.durationSec });
        comparison = compareBeats(
          goldBeats.filter((beat) => beat.goldAdId === goldAd.id).map((beat) => ({ orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code })),
          validated.beats.map((beat) => ({ orderIndex: beat.orderIndex, layer: beat.layer, code: beat.code })),
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (cause instanceof ExtractValidationError || /not valid JSON|no text/.test(message)) {
          previousError = message;
          error = message;
        } else {
          error = message;
          break;
        }
      }
    }
    const result: EvalAdResult = { externalId: goldAd.externalId, title: goldAd.title, quarantined: !comparison, error: comparison ? null : error, comparison, attempts: Math.min(attempts - 1, 2) };
    results.push(result);
    input.onProgress?.(result);
  }

  const summary = summarizeEval(results);
  const passed = (summary.layerAgreement ?? 0) >= GATE1_LAYER_THRESHOLD && (summary.codeAgreement ?? 0) >= GATE1_CODE_THRESHOLD;
  const write = await supabase.from("CorpusEvalRun").insert({
    id: newId(),
    baselineVersion,
    taxonomyVersion,
    extractorPromptVersion: CORPUS_EXTRACT_PROMPT_VERSION,
    engineVersion: CORPUS_ENGINE_VERSION,
    model: EXTRACT_MODEL,
    goldAdCount: results.length,
    layerAgreement: summary.layerAgreement,
    codeAgreement: summary.codeAgreement,
    orderAgreement: summary.orderAgreement,
    passed,
    perAd: JSON.parse(JSON.stringify(results)) as Json,
    usage: usage ? (JSON.parse(JSON.stringify(usage)) as Json) : null,
  }).select("*").single();
  if (write.error) throw new Error(write.error.message);
  return { status: "done", run: write.data as CorpusEvalRunRow, summary, passed, usage, results };
}

/** The newest Gate-1 result for the current (taxonomy, prompt, model) tuple, if any. */
export async function latestGate1(taxonomyVersion: string = CORPUS_TAXONOMY_VERSION): Promise<CorpusEvalRunRow | null> {
  const result = await supabase.from("CorpusEvalRun").select("*")
    .eq("taxonomyVersion", taxonomyVersion).eq("extractorPromptVersion", CORPUS_EXTRACT_PROMPT_VERSION).eq("model", EXTRACT_MODEL)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CorpusEvalRunRow | null) ?? null;
}
