import "server-only";

import type { ScriptDocument } from "@/lib/cellumove/script-studio";
import {
  SCORER_EXTRACTOR_PROMPT_VERSION,
  ScorerLayerSchema,
  defaultLayerForKind,
  scriptSourceLines,
  validateAnalyzedScript,
  type AnalyzedScript,
} from "@/lib/cellumove/script-scorer";
import { FAST_MODEL, getLLM } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), text].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { return JSON.parse(candidate.trim()) as unknown; } catch { /* try the next candidate */ }
  }
  throw new Error("Extractor response was not valid JSON.");
}

function buildPrompt(input: {
  document: ScriptDocument;
  taxonomy: Array<{ code: string; layer: string; label: string; description: string }>;
  previousError?: string;
}): string {
  const lines = scriptSourceLines(input.document).map((line) => ({
    scriptModuleId: line.scriptModuleId,
    lineIndex: line.lineIndex,
    text: line.text,
    moduleKind: line.moduleKind,
    moduleLabel: line.moduleLabel,
    defaultLayerHint: defaultLayerForKind(line.moduleKind),
  }));
  return [
    "Classify every supplied script line. This is mechanical extraction, not copywriting.",
    "Return exactly one JSON object with a lines array and no prose.",
    "Never rewrite, trim, merge, split, or omit a source line.",
    "Use only the supplied taxonomy codes. Do not return a layer; the server derives it from the selected code.",
    "Use OTHER only when necessary and provide otherExplanation.",
    "Concrete spans must be exact substrings and limited to quantities, time, place, named objects, observable actions, or sensory details.",
    "Factual assertion quotes must be exact substrings. Extract checkable product, mechanism, outcome, price, guarantee, bonus, and availability claims; do not treat pure opinion as fact.",
    "Required line shape: {scriptModuleId,lineIndex,text,code,otherExplanation?,concreteSpans:[{text,kind}],factualAssertions:[{quote,normalizedClaim,claimType}]}",
    input.previousError ? `Your previous response failed validation: ${input.previousError}. Correct that exact issue.` : "",
    `TAXONOMY:\n${JSON.stringify(input.taxonomy)}`,
    `LINES:\n${JSON.stringify(lines)}`,
  ].filter(Boolean).join("\n\n");
}

export async function extractAnalyzedScript(input: {
  document: ScriptDocument;
  taxonomy: Array<{ code: string; layer: string; label: string; description: string }>;
  runId: string;
  marketCode: string;
}): Promise<AnalyzedScript> {
  const allowedCodes = new Map(input.taxonomy.map((item) => {
    const layer = ScorerLayerSchema.parse(item.layer);
    return [item.code, layer] as const;
  }));
  if (!allowedCodes.size) throw new Error("The scorer taxonomy is not configured.");
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await getLLM().models.generateContent({
      model: FAST_MODEL,
      contents: buildPrompt({ document: input.document, taxonomy: input.taxonomy, previousError }),
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0,
      },
    });
    await recordUsage({
      feature: "script_scorer",
      model: FAST_MODEL,
      usage: response.usageMetadata,
      metadata: {
        runId: input.runId,
        marketCode: input.marketCode,
        promptVersion: SCORER_EXTRACTOR_PROMPT_VERSION,
        attempt,
      },
    });
    try {
      if (!response.text?.trim()) throw new Error("Extractor returned no text.");
      return validateAnalyzedScript({ document: input.document, analysis: extractJson(response.text), allowedCodes });
    } catch (error) {
      previousError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Gemini could not produce a valid scorer extraction after two attempts: ${previousError ?? "unknown error"}`);
}
