import { z } from "zod";

export const ScriptHeatLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export const ScriptFunnelStageSchema = z.enum(["TOFU", "MOFU", "BOFU"]);
export const ScriptReferenceModeSchema = z.enum(["structure_beats", "full_style"]);

export const ScriptWorkflowBriefSchema = z.object({
  conceptLabel: z.string().trim().min(1).max(160),
  hookDirection: z.string().trim().max(600).nullable(),
  marketCode: z.string().trim().regex(/^[a-zA-Z]{2,12}$/).transform((value) => value.toUpperCase()),
  heatLevel: ScriptHeatLevelSchema,
  funnelStage: ScriptFunnelStageSchema,
  voicePlan: z.string().trim().min(1).max(160),
  offerId: z.string().nullable(),
  referenceMode: ScriptReferenceModeSchema,
  playbookVersionId: z.string().min(1),
}).strict();

export type ScriptWorkflowBrief = z.infer<typeof ScriptWorkflowBriefSchema>;

export const ScriptWorkflowPlaybookSnapshotSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  sourceHash: z.string().min(1),
  promptInstructions: z.string().min(1),
  config: z.record(z.unknown()),
}).strict();

export type ScriptWorkflowPlaybookSnapshot = z.infer<typeof ScriptWorkflowPlaybookSnapshotSchema>;

export const ScriptWorkflowEvidenceReceiptSchema = z.object({
  verbatimIds: z.array(z.string()),
  factIds: z.array(z.string()),
  offerIds: z.array(z.string()),
  referenceIds: z.array(z.string()),
}).strict();

export const ScriptWorkflowSnapshotSchema = z.object({
  brief: ScriptWorkflowBriefSchema,
  playbook: ScriptWorkflowPlaybookSnapshotSchema,
  evidence: ScriptWorkflowEvidenceReceiptSchema,
  generatedAt: z.string().datetime().nullable(),
}).strict();

export type ScriptWorkflowSnapshot = z.infer<typeof ScriptWorkflowSnapshotSchema>;

export const SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION = "script-workflow-audit-v1";
export const SCRIPT_WORKFLOW_FIX_PROMPT_VERSION = "script-workflow-fix-v1";

export const WORKFLOW_RUBRIC = {
  hook: 20,
  reframe: 15,
  mechanism: 20,
  pitch: 10,
  engagement: 15,
  trust: 12,
  close: 8,
} as const;

export type WorkflowRubricCategory = keyof typeof WORKFLOW_RUBRIC;
export type WorkflowRubricWeights = Record<WorkflowRubricCategory, number>;

export const WORKFLOW_RUBRIC_CATEGORIES = Object.keys(WORKFLOW_RUBRIC) as WorkflowRubricCategory[];

export const WorkflowFindingCategorySchema = z.enum([
  "hook",
  "reframe",
  "mechanism",
  "pitch",
  "engagement",
  "trust",
  "close",
  "cadence",
  "originality",
]);

export const WorkflowFindingSeveritySchema = z.enum(["info", "warning", "critical"]);

export const WorkflowAuditFindingSchema = z.object({
  ruleId: z.string().trim().min(1).max(100),
  category: WorkflowFindingCategorySchema,
  severity: WorkflowFindingSeveritySchema,
  scriptModuleId: z.string().trim().min(1),
  lineIndex: z.number().int().nonnegative(),
  scriptQuote: z.string().trim().min(1),
  message: z.string().trim().min(1).max(1000),
  recommendation: z.string().trim().min(1).max(1000),
  fixEligible: z.boolean(),
  pointsDeducted: z.number().min(0).max(100),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export type WorkflowAuditFinding = z.infer<typeof WorkflowAuditFindingSchema>;

export const WorkflowAuditExtractionSchema = z.object({
  findings: z.array(WorkflowAuditFindingSchema).max(80),
}).strict();

export type WorkflowAuditExtraction = z.infer<typeof WorkflowAuditExtractionSchema>;

export function parseWorkflowAuditExtraction(value: unknown): WorkflowAuditExtraction {
  // Gemini occasionally returns the requested findings array as the top-level
  // JSON value even when the response schema asks for { findings: [...] }.
  // The entries remain strictly validated; only the harmless outer wrapper is
  // repaired so an otherwise valid audit does not fail twice.
  return WorkflowAuditExtractionSchema.parse(Array.isArray(value) ? { findings: value } : value);
}

// Shape-only schema sent to Gemini (keys + types, no size limits — Vertex rejects
// those). It stops typo'd keys and null IDs at the source; Zod still owns limits.
export const WORKFLOW_AUDIT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleId: { type: "string" },
          category: { type: "string", enum: WorkflowFindingCategorySchema.options },
          severity: { type: "string", enum: WorkflowFindingSeveritySchema.options },
          scriptModuleId: { type: "string" },
          lineIndex: { type: "integer" },
          scriptQuote: { type: "string" },
          message: { type: "string" },
          recommendation: { type: "string" },
          fixEligible: { type: "boolean" },
          pointsDeducted: { type: "number" },
        },
        required: ["ruleId", "category", "severity", "scriptModuleId", "lineIndex", "scriptQuote", "message", "recommendation", "fixEligible", "pointsDeducted"],
      },
    },
  },
  required: ["findings"],
} as const;

// Keep every finding that is individually valid AND cites an exact quote; drop the
// rest. One malformed finding used to discard the whole audit (and cost a second
// model call). Throws only when the model returned findings and none survived.
export function salvageWorkflowFindings(
  value: unknown,
  modules: Array<{ id: string; spokenText: string; onScreenText: string; visualDirection: string }>,
): WorkflowAuditFinding[] {
  const raw = Array.isArray(value) ? value : (value as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(raw)) throw new Error("Workflow audit response had no findings array.");
  const kept: WorkflowAuditFinding[] = [];
  let firstProblem = "";
  for (const item of raw.slice(0, 80)) {
    const parsed = WorkflowAuditFindingSchema.safeParse(item);
    if (!parsed.success) {
      firstProblem ||= parsed.error.issues[0]?.message ?? "invalid finding";
      continue;
    }
    try {
      validateWorkflowFindingQuotes([parsed.data], modules);
      kept.push(parsed.data);
    } catch (error) {
      firstProblem ||= error instanceof Error ? error.message : String(error);
    }
  }
  if (raw.length > 0 && kept.length === 0) throw new Error(`No workflow finding survived validation: ${firstProblem}`);
  return kept;
}

// ─── Auto-fix (one targeted pass on a weak first draft) ─────────────────────────

/** A re-scored candidate must beat the draft by this much; smaller gains are audit noise. */
export const AUTOFIX_MIN_GAIN = 3;
export const AUTOFIX_MAX_MODULES = 4;

/**
 * The findings worth one fix pass: fixable, point-costing, on unlocked modules —
 * limited to the modules losing the most points so the rewrite stays targeted.
 */
export function pickWeakModules<T extends { scriptModuleId: string | null; fixEligible: boolean; pointsDeducted: number }>(
  findings: T[],
  lockedModuleIds: ReadonlySet<string>,
  maxModules = AUTOFIX_MAX_MODULES,
): T[] {
  const eligible = findings.filter((item) => item.fixEligible && item.pointsDeducted > 0 && item.scriptModuleId && !lockedModuleIds.has(item.scriptModuleId));
  const lostByModule = new Map<string, number>();
  for (const item of eligible) lostByModule.set(item.scriptModuleId!, (lostByModule.get(item.scriptModuleId!) ?? 0) + item.pointsDeducted);
  const worst = new Set([...lostByModule].sort((a, b) => b[1] - a[1]).slice(0, maxModules).map(([id]) => id));
  return eligible.filter((item) => worst.has(item.scriptModuleId!));
}

export function shouldKeepAutoFix(fromScore: number, toScore: number): boolean {
  return toScore - fromScore >= AUTOFIX_MIN_GAIN;
}

export type SpeakingRateBand = "fast_direct_response" | "standard_ugc" | "calm_testimonial" | "sung";

export function selectSpeakingRateBand(input: { format: string; voicePlan: string; avatarName?: string | null }): {
  key: SpeakingRateBand;
  min: number;
  max: number;
} {
  const text = `${input.format} ${input.voicePlan} ${input.avatarName ?? ""}`.toLocaleLowerCase();
  if (/song|sung|ballad|jingle|musical/.test(text)) return { key: "sung", min: 1.7, max: 1.9 };
  if (/calm|gentle|reassur|testimonial|older|over\s*(?:4\d|5\d|6\d)|sensitive|health/.test(text)) {
    return { key: "calm_testimonial", min: 2.3, max: 3.0 };
  }
  if (/fast|rapid|direct response|high energy|dynamic/.test(text)) {
    return { key: "fast_direct_response", min: 3.3, max: 4.0 };
  }
  return { key: "standard_ugc", min: 2.8, max: 3.4 };
}

export function workflowGateStatus(score: number): "pass" | "needs_refinement" | "weak_alignment" {
  if (score >= 85) return "pass";
  if (score >= 70) return "needs_refinement";
  return "weak_alignment";
}

export function workflowRubricFromConfig(config: Record<string, unknown>): WorkflowRubricWeights {
  const configured = config.auditRubric;
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) return { ...WORKFLOW_RUBRIC };
  const weights = { ...WORKFLOW_RUBRIC } as WorkflowRubricWeights;
  for (const category of WORKFLOW_RUBRIC_CATEGORIES) {
    const entry = (configured as Record<string, unknown>)[category];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ...WORKFLOW_RUBRIC };
    const weight = (entry as Record<string, unknown>).weight;
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 0 || weight > 100) return { ...WORKFLOW_RUBRIC };
    weights[category] = weight;
  }
  return Object.values(weights).reduce((sum, weight) => sum + weight, 0) === 100 ? weights : { ...WORKFLOW_RUBRIC };
}

export function calculateWorkflowScore(findings: WorkflowAuditFinding[], weights: WorkflowRubricWeights = WORKFLOW_RUBRIC): number {
  const deductions = new Map<WorkflowRubricCategory, number>();
  for (const finding of findings) {
    if (!WORKFLOW_RUBRIC_CATEGORIES.includes(finding.category as WorkflowRubricCategory)) continue;
    const category = finding.category as WorkflowRubricCategory;
    deductions.set(category, (deductions.get(category) ?? 0) + finding.pointsDeducted);
  }
  return WORKFLOW_RUBRIC_CATEGORIES.reduce((sum, category) => {
    const available = weights[category];
    return sum + Math.max(0, available - Math.min(available, deductions.get(category) ?? 0));
  }, 0);
}

export function validateWorkflowFindingQuotes(
  findings: WorkflowAuditFinding[],
  modules: Array<{ id: string; spokenText: string; onScreenText: string; visualDirection: string }>,
): void {
  const byId = new Map(modules.map((module) => [module.id, module]));
  for (const finding of findings) {
    const scriptModule = byId.get(finding.scriptModuleId);
    if (!scriptModule) throw new Error(`Workflow audit cited unknown module ${finding.scriptModuleId}.`);
    const source = [scriptModule.spokenText, scriptModule.onScreenText, scriptModule.visualDirection].join("\n");
    if (!source.includes(finding.scriptQuote)) {
      throw new Error(`Workflow audit quote is not exact for module ${finding.scriptModuleId}.`);
    }
  }
}

export function lexicalLineSimilarity(left: string, right: string): number {
  const tokens = (text: string) => new Set(text.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}
