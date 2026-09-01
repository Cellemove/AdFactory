// Usage tracking for Gemini calls. Each generateContent() call records one
// Usage row; the /usage page aggregates them by day/feature.
//
// Prices are Vertex AI as of mid-2026 — approximate, used only to compute an
// estimated cost shown to the user. Adjust the table below if Google's pricing
// changes. Prices are PER MODEL: costing a Flash call at Pro rates overstates it
// ~4x and would make a model downgrade look like a bigger win than it is.

import { supabase, newId } from "@/lib/db";

interface ModelPrice {
  /** USD per input token. */
  input: number;
  /** USD per output token. Vertex bills thinking tokens at this same rate. */
  output: number;
}

// Per-million-token list prices, converted to per-token.
const PRO_PRICE: ModelPrice = { input: 1.25 / 1_000_000, output: 10 / 1_000_000 };
const FLASH_PRICE: ModelPrice = { input: 0.3 / 1_000_000, output: 2.5 / 1_000_000 };
const FLASH_LITE_PRICE: ModelPrice = { input: 0.1 / 1_000_000, output: 0.4 / 1_000_000 };

// Longest prefix wins, so versioned ids ("gemini-2.5-flash-002") price correctly
// and flash-lite is never mistaken for flash.
const MODEL_PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ["gemini-2.5-flash-lite", FLASH_LITE_PRICE],
  ["gemini-2.5-flash", FLASH_PRICE],
  ["gemini-2.5-pro", PRO_PRICE],
];

export function priceFor(model: string | null | undefined): ModelPrice {
  const id = model?.trim();
  if (!id) return PRO_PRICE;
  // Unknown models fall back to Pro so a new model never silently under-reports.
  return MODEL_PRICES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? PRO_PRICE;
}

// Google Search grounding is billed per request — Gemini 2.5 = $35 / 1k.
const PRICE_GROUNDED_REQUEST_USD = 0.035;

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  // Portion of promptTokenCount served from context cache. Without capturing
  // this there is no way to tell whether caching is firing at all — a silent
  // cache miss looks identical to no caching.
  cachedContentTokenCount?: number;
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
  /** Defaults to Pro pricing when omitted, preserving the pre-tiering behaviour. */
  model?: string | null;
}): number {
  const price = priceFor(opts.model);
  const cost =
    opts.inputTokens * price.input +
    // Thinking bills at the output rate — on Pro that is 8x the input rate, which
    // is why a short-output call with a big thinking budget is so expensive.
    (opts.outputTokens + opts.thinkingTokens) * price.output +
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
    model: input.model,
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
      metadata: (() => {
      // Fold the cache-hit count into metadata so /usage can show whether
      // caching is working, without needing a schema migration.
      const cached = input.usage?.cachedContentTokenCount ?? 0;
      const meta = cached > 0 ? { ...(input.metadata ?? {}), cachedTokens: cached } : input.metadata;
      return meta ? JSON.stringify(meta) : null;
    })(),
      createdAt: new Date().toISOString(),
    });
    if (error) {
      console.warn("[usage] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[usage] insert threw:", e instanceof Error ? e.message : String(e));
  }
}
