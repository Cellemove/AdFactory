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

/**
 * Vertex answers a burst of video calls with 429 "resource exhausted" or a
 * transient 503. Over a hundred ads that would fail whole batches, so the seam
 * waits and tries again; anything else (a bad request, a refusal) fails at once.
 */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|resource exhausted|UNAVAILABLE|overloaded|deadline exceeded/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One JSON-mode model call. Throws on transport/model errors; returns raw text otherwise. */
export async function generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
  const model = request.model ?? DEFAULT_MODEL;
  const response = await callWithRetry(model, request);
  await recordUsage({ feature: request.feature, model, usage: response.usageMetadata, metadata: request.metadata });
  const text = response.text ?? "";
  if (!text.trim()) throw new Error("The model returned no text.");
  return { text, usage: summarizeUsage(model, response.usageMetadata) };
}

async function callWithRetry(model: string, request: StructuredRequest) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await rawCall(model, request);
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isTransient(error) || delay === undefined) throw error;
      // Jitter so parallel lanes do not all come back at the same moment.
      const wait = delay + Math.floor(Math.random() * 2_000);
      console.warn(`[corpus] ${model} is rate-limited; retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}).`);
      await sleep(wait);
    }
  }
  throw lastError;
}

async function rawCall(model: string, request: StructuredRequest) {
  return getLLM().models.generateContent({
    model,
    contents: [{ role: "user", parts: request.parts }],
    config: {
      responseMimeType: "application/json",
      temperature: request.temperature ?? 0,
      maxOutputTokens: request.maxOutputTokens ?? 16384,
      ...(request.thinkingBudget != null ? { thinkingConfig: { thinkingBudget: request.thinkingBudget } } : {}),
    },
  });
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
