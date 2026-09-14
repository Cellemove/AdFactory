import "server-only";

// The one place the corpus pipeline calls a model. TRANSCRIBE, EXTRACT and the
// Gate-1 eval all go through `generateStructured`, so swapping Gemini for
// another provider (the spec names the Claude API) is an adapter here and
// nothing in the stages changes.

import { DEFAULT_MODEL, getLLM } from "@/lib/llm";
import { computeCostUsd, recordUsage, type GeminiUsageMetadata } from "@/lib/usage";

export type StructuredPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type StructuredRequest = {
  model?: string;
  parts: StructuredPart[];
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  /** Usage-ledger feature name (see USAGE_FEATURES). */
  feature: string;
  metadata?: Record<string, unknown>;
};

export type UsageSummary = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  estimatedCostUsd: number;
};

export type StructuredResponse = {
  text: string;
  usage: UsageSummary;
};

export function summarizeUsage(model: string, usage: GeminiUsageMetadata | undefined | null): UsageSummary {
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const thinkingTokens = usage?.thoughtsTokenCount ?? 0;
  return {
    model,
    inputTokens,
    outputTokens,
    thinkingTokens,
    estimatedCostUsd: computeCostUsd({ inputTokens, outputTokens, thinkingTokens, model }),
  };
}

export function addUsage(a: UsageSummary | null, b: UsageSummary): UsageSummary {
  if (!a) return b;
  return {
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    estimatedCostUsd: Math.round((a.estimatedCostUsd + b.estimatedCostUsd) * 1_000_000) / 1_000_000,
  };
}

/** One JSON-mode model call. Throws on transport/model errors; returns raw text otherwise. */
export async function generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
  const model = request.model ?? DEFAULT_MODEL;
  const response = await getLLM().models.generateContent({
    model,
    contents: [{ role: "user", parts: request.parts }],
    config: {
      responseMimeType: "application/json",
      temperature: request.temperature ?? 0,
      maxOutputTokens: request.maxOutputTokens ?? 16384,
      ...(request.thinkingBudget != null ? { thinkingConfig: { thinkingBudget: request.thinkingBudget } } : {}),
    },
  });
  await recordUsage({ feature: request.feature, model, usage: response.usageMetadata, metadata: request.metadata });
  const text = response.text ?? "";
  if (!text.trim()) throw new Error("The model returned no text.");
  return { text, usage: summarizeUsage(model, response.usageMetadata) };
}

/** Pull the first balanced JSON object out of a response, tolerating code fences. */
export function parseJsonObject(text: string): unknown {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("The model response was not valid JSON.");
}
