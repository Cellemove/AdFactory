// Usage tracking for Gemini calls. Each generateContent() call records one
// Usage row; the /usage page aggregates them by day/feature.
//
// Prices are Gemini 2.5 Pro on Vertex AI as of mid-2026 — approximate, used
// only to compute an estimated cost shown to the user. Adjust the constants
// below if Google's pricing changes or you switch model.

import { supabase, newId } from "@/lib/db";

// Per-token prices in USD. Vertex bills thinking tokens at the output rate.
const PRICE_INPUT_USD_PER_TOKEN = 1.25 / 1_000_000;
const PRICE_OUTPUT_USD_PER_TOKEN = 10 / 1_000_000;
const PRICE_THINKING_USD_PER_TOKEN = 10 / 1_000_000;
// Google Search grounding is billed per request — Gemini 2.5 = $35 / 1k.
const PRICE_GROUNDED_REQUEST_USD = 0.035;

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface RecordUsageInput {
  feature: string;
  model: string;
  usage: GeminiUsageMetadata | undefined | null;
  grounded?: boolean;
  metadata?: Record<string, unknown>;
}

export function computeCostUsd(opts: {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  grounded?: boolean;
}): number {
  const cost =
    opts.inputTokens * PRICE_INPUT_USD_PER_TOKEN +
    opts.outputTokens * PRICE_OUTPUT_USD_PER_TOKEN +
    opts.thinkingTokens * PRICE_THINKING_USD_PER_TOKEN +
    (opts.grounded ? PRICE_GROUNDED_REQUEST_USD : 0);
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimals
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const inputTokens = input.usage?.promptTokenCount ?? 0;
  const outputTokens = input.usage?.candidatesTokenCount ?? 0;
  const thinkingTokens = input.usage?.thoughtsTokenCount ?? 0;
  const estimatedCostUsd = computeCostUsd({
    inputTokens,
    outputTokens,
    thinkingTokens,
    grounded: input.grounded,
  });
  // Best-effort: don't crash the calling action if the Usage table doesn't
  // exist yet or the insert fails — log and move on.
  try {
    const { error } = await supabase.from("Usage").insert({
      id: newId(),
      feature: input.feature,
      model: input.model,
      inputTokens,
      outputTokens,
      thinkingTokens,
      estimatedCostUsd,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date().toISOString(),
    });
    if (error) {
      console.warn("[usage] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[usage] insert threw:", e instanceof Error ? e.message : String(e));
  }
}
