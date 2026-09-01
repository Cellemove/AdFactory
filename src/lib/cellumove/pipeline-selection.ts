export interface PipelineRunSelection {
  subAvatarId: string;
  angleSlug: string;
  completedStages: number;
}

export function parsePipelineRunSelection(value: string): PipelineRunSelection | null {
  try {
    const parsed = JSON.parse(value) as { subAvatarId?: unknown; angleSlug?: unknown; stages?: Record<string, unknown> };
    if (typeof parsed.subAvatarId !== "string" || typeof parsed.angleSlug !== "string") return null;
    return {
      subAvatarId: parsed.subAvatarId,
      angleSlug: parsed.angleSlug,
      completedStages: parsed.stages ? Object.values(parsed.stages).filter((stage) => stage != null).length : 0,
    };
  } catch {
    return null;
  }
}
