import "server-only";

import { z } from "zod";
import { extractJsonObject, runAgent } from "@/lib/cellumove/agents";
import { EMBED_MODEL, embedTexts } from "@/lib/cellumove/embeddings";
import {
  calculateWorkflowScore,
  lexicalLineSimilarity,
  pickWeakModules,
  salvageWorkflowFindings,
  SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION,
  SCRIPT_WORKFLOW_FIX_PROMPT_VERSION,
  selectSpeakingRateBand,
  shouldKeepAutoFix,
  validateWorkflowFindingQuotes,
  WORKFLOW_AUDIT_RESPONSE_JSON_SCHEMA,
  workflowRubricFromConfig,
  workflowGateStatus,
  type WorkflowAuditFinding,
} from "@/lib/cellumove/script-creative-workflow";
import { loadPublishedScriptPlaybook, loadScriptPlaybookVersion } from "@/lib/cellumove/script-playbook.server";
import { scriptSourceLines } from "@/lib/cellumove/script-scorer";
import { hashWorkflowDocument, normalizedLineHash } from "@/lib/cellumove/script-workflow-hash";
import { inspectScriptQuality, parseScriptDocument, type ScriptDocument } from "@/lib/cellumove/script-studio";
import type {
  Json,
  ScriptLineFingerprintRow,
  ScriptProjectRow,
  ScriptSourceRow,
  ScriptWorkflowAuditRunRow,
  ScriptWorkflowFindingRow,
} from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";
import { modelFor } from "@/lib/llm";

export type ScriptWorkflowAuditResult = {
  run: ScriptWorkflowAuditRunRow;
  findings: ScriptWorkflowFindingRow[];
};

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function finding(input: Omit<WorkflowAuditFinding, "metadata"> & { metadata?: Record<string, unknown> }): WorkflowAuditFinding {
  return { ...input, metadata: input.metadata ?? {} };
}

function exactModuleQuote(module: ScriptDocument["modules"][number]): string {
  return scriptSourceLines({ modules: [module] } as ScriptDocument)[0]?.text
    || module.onScreenText.trim()
    || module.visualDirection.trim();
}

export function deterministicWorkflowFindings(document: ScriptDocument): WorkflowAuditFinding[] {
  const findings: WorkflowAuditFinding[] = [];
  const lines = scriptSourceLines(document);
  const first = lines[0];
  const hookModule = document.modules.find((module) => module.kind === "hook") ?? document.modules[0];
  if (hookModule && first) {
    const hookWords = words(first.text);
    if (hookWords < 8 || hookWords > 13) findings.push(finding({
      ruleId: "hook.word_band", category: "hook", severity: "warning", scriptModuleId: hookModule.id,
      lineIndex: first.lineIndex, scriptQuote: first.text, message: `The opening line has ${hookWords} words; the playbook target is 8–13.`,
      recommendation: "Tighten or expand the opening line without changing its evidence-backed promise.", fixEligible: true, pointsDeducted: 3,
    }));
    if (hookModule.visualDirection.trim().length < 25) findings.push(finding({
      ruleId: "hook.visual_interrupt", category: "hook", severity: "warning", scriptModuleId: hookModule.id,
      lineIndex: first.lineIndex, scriptQuote: first.text, message: "The opening lacks a sufficiently specific, shootable visual interruption.",
      recommendation: "Specify the first frame, subject, physical action, and visible prop.", fixEligible: true, pointsDeducted: 2,
    }));
  }

  const productName = document.product.name.toLocaleLowerCase();
  const allCopy = document.modules.map((module) => module.spokenText).join(" ");
  const productMentions = allCopy.toLocaleLowerCase().split(productName).length - 1;
  const firstFortyPercent = document.modules.slice(0, Math.max(1, Math.ceil(document.modules.length * 0.4))).map((module) => module.spokenText).join(" ").toLocaleLowerCase();
  const pitchModule = document.modules.find((module) => module.kind === "solution") ?? document.modules.find((module) => module.spokenText.trim())!;
  if (pitchModule && productMentions < 3) findings.push(finding({
    ruleId: "pitch.product_mentions", category: "pitch", severity: "warning", scriptModuleId: pitchModule.id,
    lineIndex: 0, scriptQuote: exactModuleQuote(pitchModule), message: `The product is named ${productMentions} time${productMentions === 1 ? "" : "s"}; the playbook target is at least three.`,
    recommendation: "Add natural product mentions where the mechanism, proof, and close need a clear subject.", fixEligible: true, pointsDeducted: 2,
  }));
  if (pitchModule && !firstFortyPercent.includes(productName)) findings.push(finding({
    ruleId: "pitch.named_by_40_percent", category: "pitch", severity: "warning", scriptModuleId: pitchModule.id,
    lineIndex: 0, scriptQuote: exactModuleQuote(pitchModule), message: "The product is not named within the first 40% of the script.",
    recommendation: "Name the product once the problem and reframe are clear.", fixEligible: true, pointsDeducted: 3,
  }));

  const rate = selectSpeakingRateBand({ format: document.format, voicePlan: document.workflow.brief.voicePlan, avatarName: document.avatar?.name });
  for (const scriptModule of document.modules) {
    if (!scriptModule.spokenText.trim() || scriptModule.durationSec <= 0) continue;
    const actual = words(scriptModule.spokenText) / scriptModule.durationSec;
    if (actual < rate.min - 0.25 || actual > rate.max + 0.25) findings.push(finding({
      ruleId: "cadence.speaking_rate", category: "cadence", severity: "warning", scriptModuleId: scriptModule.id,
      lineIndex: 0, scriptQuote: scriptSourceLines({ ...document, modules: [scriptModule] })[0]?.text ?? scriptModule.spokenText,
      message: `${actual.toFixed(1)} words/second falls outside the ${rate.min.toFixed(1)}–${rate.max.toFixed(1)} ${rate.key.replaceAll("_", " ")} band.`,
      recommendation: actual > rate.max ? "Shorten the copy or give the beat more time." : "Add useful specificity or shorten the beat timing.",
      fixEligible: true, pointsDeducted: 0, metadata: { actualRate: actual, rateBand: rate.key },
    }));
  }

  const cta = document.modules.find((module) => module.kind === "cta");
  if (!cta?.spokenText.trim()) {
    const fallback = [...document.modules].reverse().find((module) => exactModuleQuote(module));
    if (fallback) findings.push(finding({
        ruleId: "close.missing_cta", category: "close", severity: "critical", scriptModuleId: fallback.id,
        lineIndex: 0, scriptQuote: exactModuleQuote(fallback), message: "The script has no spoken call to action.",
        recommendation: "Add a flat, low-friction next step supported by the selected funnel and offer.", fixEligible: true, pointsDeducted: 2,
      }));
  }
  return findings;
}

function auditPrompt(document: ScriptDocument, previousError?: string): string {
  return [
    "Audit this ad script against the supplied versioned Creative Strategist playbook.",
    "This is diagnostic extraction, not rewriting. Return JSON only with a findings array.",
    "Every finding must cite one exact, non-empty substring from the cited module. Never paraphrase scriptQuote.",
    "Use only these categories: hook, reframe, mechanism, pitch, engagement, trust, close, cadence, originality.",
    "Use deductions only for the seven scored categories. Cadence and originality findings must deduct 0 points.",
    "Do not evaluate factual truth here; the separate evidence scorer owns claim support.",
    "Do not penalize a reference for not using one universal beat spine; judge whether its selected structure is coherent.",
    "Finding shape: {ruleId,category,severity,scriptModuleId,lineIndex,scriptQuote,message,recommendation,fixEligible,pointsDeducted}. scriptModuleId must be one of the MODULES ids and lineIndex a non-negative integer — never null.",
    previousError ? `Previous output failed validation: ${previousError}` : "",
    `WORKFLOW: ${JSON.stringify(document.workflow)}`,
    `MODULES: ${JSON.stringify(document.modules.map((module) => ({ id: module.id, kind: module.kind, label: module.label, seconds: module.durationSec, spokenText: module.spokenText, onScreenText: module.onScreenText, visualDirection: module.visualDirection })))}`,
  ].filter(Boolean).join("\n\n");
}

async function extractSemanticFindings(document: ScriptDocument): Promise<WorkflowAuditFinding[]> {
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await runAgent({
        role: "strategist",
        instruction: "You are AdFactory's Creative Workflow auditor. Identify playbook adherence problems with exact script citations. Never rewrite the script and never decide factual support.",
        context: auditPrompt(document, previousError),
        json: true,
        responseJsonSchema: WORKFLOW_AUDIT_RESPONSE_JSON_SCHEMA,
        feature: "script_workflow_audit",
        metadata: { promptVersion: SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION, attempt, retryReason: previousError?.slice(0, 300) },
        maxOutputTokens: 12288,
        thinkingBudget: 2048,
        temperature: 0,
      });
      return salvageWorkflowFindings(extractJsonObject<unknown>(text), document.modules);
    } catch (error) {
      previousError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Workflow audit could not produce valid cited findings: ${previousError ?? "unknown validation error"}`);
}

function keyLines(document: ScriptDocument) {
  return document.modules.flatMap((module) => {
    if (!module.spokenText.trim()) return [];
    const lineKind = module.kind === "hook" ? "hook" : module.kind === "cta" ? "cta" : module.kind === "offer" ? "guarantee_or_offer" : module.kind === "proof" ? "proof" : module.kind === "solution" ? "payoff" : null;
    return lineKind ? [{ moduleId: module.id, lineKind, text: module.spokenText.trim() }] : [];
  });
}

function nestedStrings(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length >= 20 ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(nestedStrings);
  return [];
}

function referenceFragments(source: ScriptSourceRow): string[] {
  if (source.sourceType === "teardown") return nestedStrings(source.snapshot);
  if (source.sourceType !== "manual" || !source.snapshot || typeof source.snapshot !== "object" || Array.isArray(source.snapshot)) return [];
  const framework = (source.snapshot as Record<string, unknown>).framework;
  if (!framework || typeof framework !== "object" || Array.isArray(framework)) return [];
  return nestedStrings((framework as Record<string, unknown>).exampleScripts);
}

async function originalityFindings(projectId: string, document: ScriptDocument): Promise<WorkflowAuditFinding[]> {
  const current = keyLines(document);
  if (!current.length) return [];
  const [recent, referenceResult] = await Promise.all([
    supabase.from("ScriptLineFingerprint").select("*").neq("projectId", projectId).order("createdAt", { ascending: false }).limit(500),
    supabase.from("ScriptSource").select("*").eq("projectId", projectId).in("sourceType", ["teardown", "manual"]),
  ]);
  const historical = (recent.data ?? []) as ScriptLineFingerprintRow[];
  const references = ((referenceResult.data ?? []) as ScriptSourceRow[]).flatMap((source) => referenceFragments(source).map((text) => ({ source, text })));
  const embeddings = await embedTexts(current.map((line) => line.text));
  const findings: WorkflowAuditFinding[] = [];
  for (let index = 0; index < current.length; index += 1) {
    const line = current[index]!;
    let best = historical.map((item) => ({ item, similarity: lexicalLineSimilarity(line.text, item.text) })).sort((a, b) => b.similarity - a.similarity)[0];
    const embedding = embeddings?.[index];
    if (embedding?.length === 768) {
      const rpc = await supabase.rpc("match_script_lines", { query_embedding: `[${embedding.join(",")}]`, match_count: 1, exclude_project_id: projectId });
      const semantic = (rpc.data?.[0] ?? null) as ({ id: string; projectId: string; scriptVersion: number; scriptModuleId: string; lineKind: string; text: string; similarity: number } | null);
      if (semantic && (!best || semantic.similarity > best.similarity)) best = { item: { ...semantic, normalizedHash: "", embedding: null, embeddingModel: null, createdAt: "" }, similarity: semantic.similarity };
    }
    if (best && best.similarity >= 0.82) findings.push(finding({
      ruleId: "originality.historical_near_reuse", category: "originality", severity: "warning", scriptModuleId: line.moduleId,
      lineIndex: 0, scriptQuote: line.text, message: `This ${line.lineKind} is close to a line used in another script.`,
      recommendation: "Review the earlier line and keep this one only if the overlap is intentional.", fixEligible: true, pointsDeducted: 0,
      metadata: { matchedProjectId: best.item.projectId, matchedVersion: best.item.scriptVersion, matchedQuote: best.item.text, similarity: best.similarity },
    }));
    const referenceBest = references
      .map((candidate) => ({ ...candidate, similarity: lexicalLineSimilarity(line.text, candidate.text) }))
      .sort((left, right) => right.similarity - left.similarity)[0];
    if (referenceBest && referenceBest.similarity >= 0.82) findings.push(finding({
      ruleId: "originality.reference_near_reuse", category: "originality", severity: "warning", scriptModuleId: line.moduleId,
      lineIndex: 0, scriptQuote: line.text, message: `This ${line.lineKind} closely resembles wording in the selected reference.`,
      recommendation: "Keep the reference's function and pacing, but rewrite the line in the brief and avatar's own language.", fixEligible: true, pointsDeducted: 0,
      metadata: { sourceId: referenceBest.source.sourceId, sourceTitle: referenceBest.source.title, sourceUrl: referenceBest.source.url, matchedQuote: referenceBest.text, similarity: referenceBest.similarity },
    }));
  }
  return findings;
}

async function fingerprintVersion(projectId: string, scriptVersion: number, document: ScriptDocument): Promise<void> {
  const lines = keyLines(document);
  const embeddings = await embedTexts(lines.map((line) => line.text));
  if (!lines.length) return;
  await supabase.from("ScriptLineFingerprint").upsert(lines.map((line, index) => ({
    id: newId(), projectId, scriptVersion, scriptModuleId: line.moduleId, lineKind: line.lineKind, text: line.text,
    normalizedHash: normalizedLineHash(line.text),
    embedding: embeddings?.[index]?.length === 768 ? `[${embeddings[index]!.join(",")}]` : null,
    embeddingModel: embeddings?.[index]?.length === 768 ? EMBED_MODEL : null,
    createdAt: new Date().toISOString(),
  })), { onConflict: "projectId,scriptVersion,scriptModuleId,lineKind,normalizedHash", ignoreDuplicates: true });
}

/** Findings + score for a document. Writes nothing — the run and the auto-fix candidate both use it. */
async function scoreWorkflowDocument(projectId: string, document: ScriptDocument): Promise<{ findings: WorkflowAuditFinding[]; score: number }> {
  const [semantic, originality] = await Promise.all([
    extractSemanticFindings(document),
    originalityFindings(projectId, document),
  ]);
  const combined = [...deterministicWorkflowFindings(document), ...semantic, ...originality];
  const seen = new Set<string>();
  const findings = combined.filter((item) => {
    const key = `${item.ruleId}:${item.scriptModuleId}:${item.scriptQuote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  validateWorkflowFindingQuotes(findings, document.modules);
  return { findings, score: calculateWorkflowScore(findings, workflowRubricFromConfig(document.workflow.playbook.config)) };
}

export async function runScriptWorkflowAudit(input: {
  project: ScriptProjectRow;
  document: ScriptDocument;
  revision: number;
  scriptVersion: number | null;
  actorUserId: string;
}): Promise<ScriptWorkflowAuditResult> {
  const document = parseScriptDocument(input.document);
  const playbook = document.workflow.playbook.id === "legacy-script-playbook"
    ? await loadPublishedScriptPlaybook()
    : await loadScriptPlaybookVersion(document.workflow.playbook.id);
  if (document.workflow.playbook.id !== "legacy-script-playbook" && playbook.sourceHash !== document.workflow.playbook.sourceHash) {
    throw new Error("The script's playbook snapshot does not match its stored version.");
  }
  const now = new Date().toISOString();
  const runId = newId();
  const documentHash = hashWorkflowDocument(document);
  const insert = await supabase.from("ScriptWorkflowAuditRun").insert({
    id: runId, projectId: input.project.id, scriptVersion: input.scriptVersion, documentHash, revision: input.revision,
    playbookVersionId: playbook.id, promptVersion: SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION, model: modelFor("script_workflow_audit"),
    status: "running", gateStatus: "pending", contextSnapshot: asJson({ workflow: document.workflow, moduleCount: document.modules.length }),
    createdByUserId: input.actorUserId, startedAt: now, createdAt: now,
  }).select("*").single();
  if (insert.error) throw new Error(insert.error.message);

  try {
    const { findings, score } = await scoreWorkflowDocument(input.project.id, document);
    if (findings.length) {
      const saved = await supabase.from("ScriptWorkflowFinding").insert(findings.map((item) => ({
        id: newId(), runId, ruleId: item.ruleId, category: item.category, severity: item.severity,
        scriptModuleId: item.scriptModuleId, lineIndex: item.lineIndex, scriptQuote: item.scriptQuote,
        message: item.message, recommendation: item.recommendation, fixEligible: item.fixEligible,
        pointsDeducted: item.pointsDeducted, metadata: asJson(item.metadata), createdAt: new Date().toISOString(),
      }))).select("*");
      if (saved.error) throw new Error(saved.error.message);
    }
    const completedAt = new Date().toISOString();
    const updated = await supabase.from("ScriptWorkflowAuditRun").update({ status: "complete", score, gateStatus: workflowGateStatus(score), completedAt }).eq("id", runId).select("*").single();
    if (updated.error) throw new Error(updated.error.message);
    if (input.scriptVersion != null) await fingerprintVersion(input.project.id, input.scriptVersion, document);
    const rows = await supabase.from("ScriptWorkflowFinding").select("*").eq("runId", runId).order("createdAt");
    return { run: updated.data as ScriptWorkflowAuditRunRow, findings: (rows.data ?? []) as ScriptWorkflowFindingRow[] };
  } catch (error) {
    await supabase.from("ScriptWorkflowAuditRun").update({ status: "failed", gateStatus: "failed", errorSummary: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }).eq("id", runId);
    throw error;
  }
}

const FixModuleSchema = z.object({
  id: z.string().min(1),
  spokenText: z.string().min(1),
  onScreenText: z.string(),
  visualDirection: z.string().min(1),
}).strict();

export async function proposeWorkflowFix(input: {
  project: ScriptProjectRow;
  document: ScriptDocument;
  expectedRevision: number;
  auditRun: ScriptWorkflowAuditRunRow;
  findings: ScriptWorkflowFindingRow[];
}): Promise<Array<z.infer<typeof FixModuleSchema>>> {
  const document = parseScriptDocument(input.document);
  if (input.project.revision !== input.expectedRevision || input.auditRun.revision !== input.expectedRevision) throw new Error("The script changed after this audit. Rerun the audit before applying fixes.");
  if (hashWorkflowDocument(document) !== input.auditRun.documentHash) throw new Error("The audit no longer matches the open script. Rerun it before applying fixes.");
  const moduleIds = [...new Set(input.findings.filter((item) => item.fixEligible).flatMap((item) => item.scriptModuleId ? [item.scriptModuleId] : []))];
  if (!moduleIds.length) throw new Error("Choose at least one fixable finding.");
  const modules = moduleIds.map((id) => document.modules.find((module) => module.id === id)).filter((module): module is NonNullable<typeof module> => Boolean(module));
  if (modules.some((module) => module.locked)) throw new Error("Unlock the affected beats before applying Workflow fixes.");

  const response = await runAgent({
    role: "copywriter",
    additionalRoles: ["strategist", "designer"],
    instruction: "Revise only the requested Script Studio modules. Preserve facts, offer terms, module IDs, timing, accepted beats, and the script's angle. Return JSON only.",
    context: JSON.stringify({
      workflow: document.workflow,
      selectedFindings: input.findings.map((item) => ({ id: item.id, ruleId: item.ruleId, moduleId: item.scriptModuleId, quote: item.scriptQuote, message: item.message, recommendation: item.recommendation })),
      modules: modules.map((module) => ({ id: module.id, label: module.label, kind: module.kind, seconds: module.durationSec, spokenText: module.spokenText, onScreenText: module.onScreenText, visualDirection: module.visualDirection })),
      requiredShape: { modules: [{ id: "module ID", spokenText: "complete VO", onScreenText: "overlay", visualDirection: "shootable direction" }] },
    }),
    json: true,
    feature: "script_workflow_fix",
    metadata: { promptVersion: SCRIPT_WORKFLOW_FIX_PROMPT_VERSION, auditRunId: input.auditRun.id, findingIds: input.findings.map((item) => item.id) },
    maxOutputTokens: 8192,
    thinkingBudget: 2048,
  });
  const parsed = z.object({ modules: z.array(FixModuleSchema).min(1) }).strict().parse(extractJsonObject<unknown>(response));
  const returned = new Set(parsed.modules.map((module) => module.id));
  if (returned.size !== moduleIds.length || moduleIds.some((id) => !returned.has(id))) throw new Error("Workflow fix did not return exactly the selected modules.");
  return parsed.modules;
}

export type WorkflowAutoFix = {
  modules: Array<z.infer<typeof FixModuleSchema>>;
  fromScore: number;
  toScore: number;
  createdAt: string;
};

/**
 * One targeted fix pass on a weak first draft. Rewrites only the modules losing
 * the most points, re-scores the result, and keeps it ONLY if it is clearly
 * better. It never touches the saved script: the proposal is stored on the audit
 * run and offered in the Workflow panel, so nothing changes under a strategist
 * who is already editing. Off unless SCRIPT_AUTOFIX=on — prove it on the bench
 * (scripts/bench.ts --autofix) before enabling in production.
 */
export async function autoFixOnce(input: {
  project: ScriptProjectRow;
  document: ScriptDocument;
  audit: ScriptWorkflowAuditResult;
}): Promise<WorkflowAutoFix | null> {
  if (process.env.SCRIPT_AUTOFIX?.trim().toLowerCase() !== "on") return null;
  const fromScore = Number(input.audit.run.score ?? 0);
  if (workflowGateStatus(fromScore) === "pass") return null;
  const document = parseScriptDocument(input.document);
  const locked = new Set(document.modules.filter((module) => module.locked).map((module) => module.id));
  const weak = pickWeakModules(input.audit.findings, locked);
  if (!weak.length) return null;

  const modules = await proposeWorkflowFix({
    project: input.project, document, expectedRevision: input.audit.run.revision, auditRun: input.audit.run, findings: weak,
  });
  const patchById = new Map(modules.map((module) => [module.id, module]));
  const candidate = parseScriptDocument({
    ...document,
    modules: document.modules.map((module) => (patchById.has(module.id) ? { ...module, ...patchById.get(module.id)! } : module)),
  });
  // Free check first: never offer a rewrite that introduces a new hard problem.
  const errorsIn = (doc: ScriptDocument) => inspectScriptQuality(doc).filter((issue) => issue.severity === "error").length;
  if (errorsIn(candidate) > errorsIn(document)) return null;

  const { score: toScore } = await scoreWorkflowDocument(input.project.id, candidate);
  if (!shouldKeepAutoFix(fromScore, toScore)) return null;

  const autoFix: WorkflowAutoFix = { modules, fromScore, toScore, createdAt: new Date().toISOString() };
  const snapshot = (input.audit.run.contextSnapshot && typeof input.audit.run.contextSnapshot === "object" && !Array.isArray(input.audit.run.contextSnapshot))
    ? input.audit.run.contextSnapshot as Record<string, unknown> : {};
  const saved = await supabase.from("ScriptWorkflowAuditRun").update({ contextSnapshot: asJson({ ...snapshot, autoFix }) }).eq("id", input.audit.run.id);
  if (saved.error) throw new Error(saved.error.message);
  return autoFix;
}
