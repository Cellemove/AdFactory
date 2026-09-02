import "server-only";

import { extractJsonObject, runAgent } from "./agents";
import type { ScriptDocument, ScriptModule } from "./script-studio";
import {
  applyScriptModuleAssistRewrite,
  buildScriptModuleAssistContext,
  SCRIPT_MODULE_ASSIST_PROMPT_VERSION,
  SCRIPT_MODULE_ASSIST_SYSTEM_INSTRUCTION,
} from "./script-module-assist";

export async function rewriteScriptModuleWithAI(input: {
  document: ScriptDocument;
  module: ScriptModule;
  notes: string;
}): Promise<ScriptModule> {
  let correction: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await runAgent({
        role: "copywriter",
        additionalRoles: ["strategist", "designer"],
        instruction: SCRIPT_MODULE_ASSIST_SYSTEM_INSTRUCTION,
        context: buildScriptModuleAssistContext({ ...input, correction }),
        json: true,
        feature: "script_module_assist",
        metadata: {
          promptVersion: SCRIPT_MODULE_ASSIST_PROMPT_VERSION,
          attempt,
          moduleId: input.module.id,
          moduleKind: input.module.kind,
        },
        maxOutputTokens: 4096,
        thinkingBudget: 1024,
      });
      return applyScriptModuleAssistRewrite(input.module, extractJsonObject<unknown>(response));
    } catch (error) {
      lastError = error;
      correction = `The previous response was invalid: ${error instanceof Error ? error.message : String(error)}. Return only valid JSON matching the required five-field schema.`;
    }
  }

  throw new Error(`AI could not revise this module after two attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

