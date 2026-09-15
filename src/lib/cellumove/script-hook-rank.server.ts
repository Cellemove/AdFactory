// Hook ranking — the network half. One cheap Flash call judges the whole pool;
// retry-with-correction mirrors script-hook-alternatives.server.ts.
import "server-only";

import { FAST_MODEL } from "@/lib/llm";
import { supabase } from "@/lib/db";
import { extractJsonObject, runAgent } from "./agents";
import {
  buildHookRankContext,
  parseGeneratedHookScores,
  SCRIPT_HOOK_RANK_PROMPT_VERSION,
  SCRIPT_HOOK_RANK_SYSTEM_INSTRUCTION,
  type HookScore,
  type RankableHook,
} from "./script-hook-rank";
import type { ScriptDocument } from "./script-studio";

// Real winners for the angle, as register calibration. Fail-soft: ranking must
// work on a fresh angle with no winners yet.
async function loadWinningHooks(angleId: string | null | undefined): Promise<string[]> {
  if (!angleId) return [];
  try {
    const res = await supabase
      .from("WinningAd")
      .select("headline, hookType")
      .eq("angleId", angleId)
      .order("createdAt", { ascending: false })
      .limit(8);
    if (res.error) return [];
    return ((res.data ?? []) as { headline: string; hookType: string | null }[])
      .map((row) => row.headline?.trim())
      .filter((headline): headline is string => Boolean(headline));
  } catch {
    return [];
  }
}

export async function rankHookCandidates(input: {
  document: ScriptDocument;
  candidates: readonly RankableHook[];
}): Promise<HookScore[]> {
  if (!input.candidates.length) return [];
  const winningHooks = await loadWinningHooks(input.document.angle?.id);

  let correction: string | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const context = buildHookRankContext({ document: input.document, candidates: input.candidates, winningHooks });
      const response = await runAgent({
        role: "strategist",
        marketCode: input.document.brief?.marketCode ?? null,
        instruction: SCRIPT_HOOK_RANK_SYSTEM_INSTRUCTION,
        context: correction ? `${context}\n<correction>${correction}</correction>` : context,
        json: true,
        model: FAST_MODEL,
        feature: "script_hook_rank",
        metadata: { promptVersion: SCRIPT_HOOK_RANK_PROMPT_VERSION, attempt, hookCount: input.candidates.length },
        maxOutputTokens: 4096,
        thinkingBudget: 0,
      });
      return parseGeneratedHookScores(extractJsonObject<unknown>(response));
    } catch (error) {
      lastError = error;
      correction = `The previous response was invalid: ${error instanceof Error ? error.message : String(error)}. Return only {"scores":[{"index":0,"score":72,"reason":"..."}]} with one entry per hook.`;
    }
  }
  throw new Error(`Hook ranking failed after two attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
