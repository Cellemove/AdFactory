import "server-only";

import { extractJsonObject, runAgent } from "./agents";
import {
  buildScriptHookAlternativesContext,
  parseGeneratedHookAlternatives,
  SCRIPT_HOOK_ALTERNATIVES_PROMPT_VERSION,
  SCRIPT_HOOK_ALTERNATIVES_SYSTEM_INSTRUCTION,
} from "./script-hook-alternatives";
import type { ScriptDocument } from "./script-studio";

export async function generateMoreHookAlternatives(input: {
  document: ScriptDocument;
}): Promise<string[]> {
  let correction: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await runAgent({
        role: "copywriter",
        additionalRoles: ["strategist"],
        instruction: SCRIPT_HOOK_ALTERNATIVES_SYSTEM_INSTRUCTION,
        context: buildScriptHookAlternativesContext({ ...input, correction }),
        json: true,
        feature: "script_hook_alternatives",
        metadata: {
          promptVersion: SCRIPT_HOOK_ALTERNATIVES_PROMPT_VERSION,
          attempt,
          existingHookCount: input.document.hookAlternatives.length,
        },
        maxOutputTokens: 2048,
        thinkingBudget: 1024,
        // Higher than the Vertex default: this call needs several genuinely
        // different hooks from a static brief, not one converged "best" answer.
        temperature: 1.3,
      });
      return parseGeneratedHookAlternatives(extractJsonObject<unknown>(response));
    } catch (error) {
      lastError = error;
      correction = `The previous response was invalid: ${error instanceof Error ? error.message : String(error)}. Return only valid JSON matching {"hookAlternatives":["string","string","string"]} with between three and eight hooks.`;
    }
  }

  throw new Error(`AI could not write new hook options after two attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
