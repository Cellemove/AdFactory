export type ScriptGenerationStage =
  | "setup"
  | "resources"
  | "retrieval"
  | "model"
  | "validation"
  | "persistence"
  | "complete";

export type ScriptGenerationLevel = "info" | "success" | "warning" | "error";

export interface ScriptGenerationProgressEvent {
  stage: ScriptGenerationStage;
  level: ScriptGenerationLevel;
  message: string;
  detail?: string;
  timestamp: string;
}

export type ScriptGenerationProgressSink = (
  event: Omit<ScriptGenerationProgressEvent, "timestamp">,
) => void | Promise<void>;

export async function reportScriptGenerationProgress(
  sink: ScriptGenerationProgressSink | undefined,
  event: Omit<ScriptGenerationProgressEvent, "timestamp">,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch (error) {
    console.warn(`Script generation progress sink failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
