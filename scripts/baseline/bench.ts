// The script bench. See scripts/bench.ts for usage.
//
// What it is for: deciding, on the app's EXISTING automatic scores, whether a
// change (a prompt edit, a cheaper model for one feature, auto-fix on/off) holds
// quality. It generates every frozen brief through createScriptProjectCore, reads
// back the workflow-audit score and the evidence-scorer module scores, records
// cost / latency / attempts, deletes what it created, and writes one artifact.
//
// Rule for moving a feature to a cheaper model: two consecutive passing
// comparisons, then add it to MODEL_BY_FEATURE in src/lib/llm.ts.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createScriptProjectCore, type CreateScriptProjectInput } from "@/lib/cellumove/create-script-project.server";
import { SCRIPT_DRAFT_PROMPT_VERSION } from "@/lib/cellumove/script-generation";
import { SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION } from "@/lib/cellumove/script-creative-workflow";
import { createScriptScoreRun, getScriptScoreRun } from "@/lib/cellumove/script-scorer.server";
import { parseScriptDocument } from "@/lib/cellumove/script-studio";
import { runScriptWorkflowAudit } from "@/lib/cellumove/script-workflow-audit.server";
import type { AppUserRow, ScriptProjectRow, ScriptWorkflowAuditRunRow, ScriptWorkflowFindingRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { modelFor } from "@/lib/llm";
import type { SessionUser } from "@/lib/auth";

const BRIEFS_PATH = path.join("scripts", "bench", "briefs.json");
// In the repo, not under the git-ignored backups/: a promotion to a cheaper model
// must be able to name artifacts the whole team can open.
const OUT_DIR = path.join("scripts", "bench", "results");

// Pass rule for --compare (candidate vs baseline). n = 5 is small: run the
// baseline twice first and only trust a comparison that beats that noise floor.
const MAX_MEAN_WORKFLOW_DROP = 2;
const MAX_MEAN_SCORER_DROP = 2;
const MAX_SINGLE_BRIEF_DROP = 8;
const MAX_MODULE_MEAN_DROP = 5;
// Pass rule for --judge-model (same documents, audited by another model).
const MAX_JUDGE_DELTA = 5;
const MAX_JUDGE_MEAN_DELTA = 3;

// Children first; ScriptProject last. Audit findings, score modules/findings and
// versions' score runs go with their parents.
const PROJECT_TABLES = ["ScriptEvent", "ScriptSource", "ScriptAssignment", "ScriptLineFingerprint", "ScriptWorkflowAuditRun", "ScriptScoreRun", "ScriptVersion"] as const;

type BriefResult = {
  index: number;
  title: string;
  ok: boolean;
  error: string | null;
  workflowScore: number | null;
  gate: string | null;
  deductions: Record<string, number>;
  scorerModules: Record<string, number | null>;
  scorerMean: number | null;
  judgeScore: number | null;
  autoFix: { fromScore: number; toScore: number } | null;
  attempts: number;
  latencyMs: number;
  costUsd: number;
  calls: number;
};

type Artifact = {
  label: string;
  createdAt: string;
  gitSha: string | null;
  versions: Record<string, string>;
  models: Record<string, string>;
  autofix: boolean;
  judgeModel: string | null;
  briefs: BriefResult[];
  summary: { ok: number; failed: number; meanWorkflow: number | null; meanScorer: number | null; meanJudgeDelta: number | null; totalCostUsd: number; meanLatencyMs: number; totalAttempts: number };
};

const mean = (values: number[]): number | null => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value: number | null, digits = 1): number | null => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const flagValue = (argv: string[], name: string): string | null => {
  const at = argv.indexOf(`--${name}`);
  return at !== -1 && argv[at + 1] && !argv[at + 1]!.startsWith("--") ? argv[at + 1]! : null;
};

async function loadBriefs(): Promise<CreateScriptProjectInput[]> {
  try {
    return JSON.parse(await readFile(BRIEFS_PATH, "utf8")) as CreateScriptProjectInput[];
  } catch {
    return [];
  }
}

/** Freeze a real project's inputs as a bench brief. */
async function dumpBrief(projectId: string): Promise<void> {
  const project = (await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()).data as ScriptProjectRow | null;
  if (!project) throw new Error(`ScriptProject ${projectId} not found.`);
  const created = (await supabase.from("ScriptEvent").select("payload").eq("projectId", projectId).eq("eventType", "project_created").limit(1).maybeSingle()).data as { payload: Record<string, unknown> } | null;
  const payload = created?.payload ?? {};
  // Projects created before the creative-workflow brief lack these four fields.
  // A brief is only frozen INPUT, so they are filled with stated defaults (and the
  // fill is printed) rather than refusing every older angle and duration.
  const published = (await supabase.from("ScriptPlaybookVersion").select("id").eq("status", "published").limit(1).maybeSingle()).data as { id: string } | null;
  const conceptLabel = project.conceptLabel || project.title;
  const marketCode = project.marketCode || "UK";
  const voicePlan = project.voicePlan || "Standard UGC";
  const playbookVersionId = project.playbookVersionId || published?.id;
  if (!playbookVersionId) throw new Error("No published Script Studio playbook to attach to this brief.");
  const filled = [!project.conceptLabel && "conceptLabel=title", !project.marketCode && "marketCode=UK", !project.voicePlan && "voicePlan=Standard UGC", !project.playbookVersionId && "playbook=published"].filter(Boolean);
  if (filled.length) console.log(`  Older project — filled defaults: ${filled.join(", ")}.`);
  const brief: CreateScriptProjectInput = {
    title: project.title, idea: project.idea, conceptLabel, hookDirection: project.hookDirection,
    marketCode, heatLevel: project.heatLevel as CreateScriptProjectInput["heatLevel"],
    funnelStage: project.funnelStage as CreateScriptProjectInput["funnelStage"], voicePlan, offerId: project.offerId,
    referenceMode: project.referenceMode as CreateScriptProjectInput["referenceMode"], playbookVersionId,
    adNumber: project.adNumber, creativeName: project.creativeName, productId: project.productId, angleId: project.angleId,
    subAvatarId: project.subAvatarId, referenceFormatId: project.referenceFormatId, strategistUserId: project.strategistUserId,
    editorUserId: null, format: project.format, targetDurationSec: project.targetDurationSec, teardownRecordId: project.teardownRecordId,
    pipelineRunId: (payload.pipelineRunId as string | null) ?? null, spySweepId: (payload.spySweepId as string | null) ?? null,
    spyAdIndex: (payload.spyAdIndex as number | null) ?? null,
  };
  const briefs = await loadBriefs();
  briefs.push(brief);
  await mkdir(path.dirname(BRIEFS_PATH), { recursive: true });
  await writeFile(BRIEFS_PATH, `${JSON.stringify(briefs, null, 2)}\n`);
  console.log(`Froze "${project.title}" (${project.marketCode}, ${project.targetDurationSec}s) as brief #${briefs.length} in ${BRIEFS_PATH}.`);
}

async function deleteProject(projectId: string): Promise<void> {
  for (const table of PROJECT_TABLES) {
    const result = await supabase.from(table).delete().eq("projectId", projectId);
    if (result.error) console.warn(`  [cleanup] ${table}: ${result.error.message}`);
  }
  const result = await supabase.from("ScriptProject").delete().eq("id", projectId);
  if (result.error) console.warn(`  [cleanup] ScriptProject: ${result.error.message}`);
}

async function usageSince(startIso: string): Promise<{ costUsd: number; calls: number }> {
  const result = await supabase.from("Usage").select("estimatedCostUsd").gte("createdAt", startIso).limit(1000);
  const rows = result.data ?? [];
  return { costUsd: rows.reduce((sum, row) => sum + (Number(row.estimatedCostUsd) || 0), 0), calls: rows.length };
}

async function runBrief(brief: CreateScriptProjectInput, index: number, stamp: string, opts: { judgeModel: string | null; keep: boolean }): Promise<BriefResult> {
  const result: BriefResult = {
    index, title: brief.title, ok: false, error: null, workflowScore: null, gate: null, deductions: {}, scorerModules: {}, scorerMean: null,
    judgeScore: null, autoFix: null, attempts: 0, latencyMs: 0, costUsd: 0, calls: 0,
  };
  const strategist = (await supabase.from("AppUser").select("*").eq("id", brief.strategistUserId).maybeSingle()).data as AppUserRow | null;
  if (!strategist) return { ...result, error: `Strategist ${brief.strategistUserId} no longer exists.` };
  const actor: SessionUser = { id: strategist.id, username: strategist.username, role: strategist.role as SessionUser["role"] };
  const startedIso = new Date().toISOString();
  const started = Date.now();
  let projectId: string | null = null;
  try {
    // Headless callers get the first audit (and auto-fix, when on) inline.
    const created = await createScriptProjectCore(
      { ...brief, title: `Bench ${stamp} #${index + 1}`.slice(0, 120), adNumber: `BN${stamp.slice(-6)}${index}`.slice(0, 40) },
      { actor, onProgress: (event) => { if (event.stage === "model" && /attempt \d\/3/.test(event.message) && event.level === "info") result.attempts += 1; } },
    );
    projectId = created.id;
    result.latencyMs = Date.now() - started;

    const run = (await supabase.from("ScriptWorkflowAuditRun").select("*").eq("projectId", projectId).eq("status", "complete").order("createdAt", { ascending: false }).limit(1).maybeSingle()).data as ScriptWorkflowAuditRunRow | null;
    if (run) {
      result.workflowScore = Number(run.score);
      result.gate = run.gateStatus;
      const fix = (run.contextSnapshot as { autoFix?: { fromScore: number; toScore: number } } | null)?.autoFix;
      if (fix) result.autoFix = { fromScore: fix.fromScore, toScore: fix.toScore };
      const findings = ((await supabase.from("ScriptWorkflowFinding").select("*").eq("runId", run.id)).data ?? []) as ScriptWorkflowFindingRow[];
      for (const finding of findings) result.deductions[finding.category] = (result.deductions[finding.category] ?? 0) + Number(finding.pointsDeducted);
    }

    const scoreRun = await createScriptScoreRun({ projectId, scriptVersion: 1, marketCode: brief.marketCode, actor });
    const scored = await getScriptScoreRun(scoreRun.runId);
    for (const scoreModule of scored?.modules ?? []) result.scorerModules[scoreModule.module] = scoreModule.score == null ? null : Number(scoreModule.score);
    // The scorer has no total: the bench's headline is the mean of the modules that produced a score.
    result.scorerMean = mean(Object.values(result.scorerModules).filter((value): value is number => value != null));

    if (opts.judgeModel) {
      // The audit IS the yardstick, so a cheaper audit model is judged on the SAME document.
      const project = (await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()).data as ScriptProjectRow;
      process.env.AI_MODEL_SCRIPT_WORKFLOW_AUDIT = opts.judgeModel;
      try {
        const judged = await runScriptWorkflowAudit({ project, document: parseScriptDocument(project.document), revision: project.revision, scriptVersion: null, actorUserId: actor.id });
        result.judgeScore = Number(judged.run.score);
      } finally {
        delete process.env.AI_MODEL_SCRIPT_WORKFLOW_AUDIT;
      }
    }
    result.ok = result.workflowScore != null;
    if (!result.ok) result.error = "No completed workflow audit.";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.latencyMs ||= Date.now() - started;
  }
  Object.assign(result, await usageSince(startedIso));
  if (projectId && !opts.keep) await deleteProject(projectId);
  return result;
}

function summarise(briefs: BriefResult[]): Artifact["summary"] {
  const ok = briefs.filter((brief) => brief.ok);
  return {
    ok: ok.length,
    failed: briefs.length - ok.length,
    meanWorkflow: round(mean(ok.map((brief) => brief.workflowScore!))),
    meanScorer: round(mean(ok.filter((brief) => brief.scorerMean != null).map((brief) => brief.scorerMean!))),
    meanJudgeDelta: round(mean(ok.filter((brief) => brief.judgeScore != null).map((brief) => Math.abs(brief.judgeScore! - brief.workflowScore!)))),
    totalCostUsd: Math.round(briefs.reduce((sum, brief) => sum + brief.costUsd, 0) * 10000) / 10000,
    meanLatencyMs: Math.round(mean(briefs.map((brief) => brief.latencyMs)) ?? 0),
    totalAttempts: briefs.reduce((sum, brief) => sum + brief.attempts, 0),
  };
}

function printRun(artifact: Artifact): void {
  console.log(`\n${artifact.label} · ${artifact.createdAt} · ${artifact.gitSha ?? "no git"} · draft ${artifact.models.script_studio_draft} · audit ${artifact.models.script_workflow_audit}${artifact.autofix ? " · auto-fix ON" : ""}`);
  for (const brief of artifact.briefs) {
    console.log(`  #${brief.index + 1} ${brief.ok ? "ok  " : "FAIL"} workflow ${String(brief.workflowScore ?? "—").padStart(4)} · scorer ${String(round(brief.scorerMean) ?? "—").padStart(5)}${brief.judgeScore != null ? ` · judge ${brief.judgeScore}` : ""}${brief.autoFix ? ` · fix ${brief.autoFix.fromScore}→${brief.autoFix.toScore}` : ""} · attempts ${brief.attempts} · ${Math.round(brief.latencyMs / 1000)}s · $${brief.costUsd.toFixed(3)}${brief.error ? ` · ${brief.error.slice(0, 120)}` : ""}`);
  }
  const s = artifact.summary;
  console.log(`  MEAN workflow ${s.meanWorkflow ?? "—"} · scorer ${s.meanScorer ?? "—"}${s.meanJudgeDelta != null ? ` · judge |Δ| ${s.meanJudgeDelta}` : ""} · attempts ${s.totalAttempts} · ${Math.round(s.meanLatencyMs / 1000)}s/brief · $${s.totalCostUsd.toFixed(3)} total · ${s.failed} failed`);
}

/** Pure: is `candidate` at least as good as `baseline` under the bench's pass rule? */
export function compareRuns(baseline: Artifact, candidate: Artifact): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (candidate.summary.failed > 0) reasons.push(`${candidate.summary.failed} generation(s) failed`);
  const drop = (a: number | null, b: number | null) => (a != null && b != null ? a - b : 0);
  if (drop(baseline.summary.meanWorkflow, candidate.summary.meanWorkflow) > MAX_MEAN_WORKFLOW_DROP) reasons.push(`mean workflow fell ${baseline.summary.meanWorkflow} → ${candidate.summary.meanWorkflow}`);
  if (drop(baseline.summary.meanScorer, candidate.summary.meanScorer) > MAX_MEAN_SCORER_DROP) reasons.push(`mean scorer fell ${baseline.summary.meanScorer} → ${candidate.summary.meanScorer}`);
  for (const base of baseline.briefs) {
    const next = candidate.briefs.find((brief) => brief.index === base.index);
    if (next && drop(base.workflowScore, next.workflowScore) > MAX_SINGLE_BRIEF_DROP) reasons.push(`brief #${base.index + 1} workflow fell ${base.workflowScore} → ${next.workflowScore}`);
  }
  const moduleMean = (artifact: Artifact, name: string) => mean(artifact.briefs.map((brief) => brief.scorerModules[name]).filter((value): value is number => value != null));
  for (const name of new Set(baseline.briefs.flatMap((brief) => Object.keys(brief.scorerModules)))) {
    if (drop(moduleMean(baseline, name), moduleMean(candidate, name)) > MAX_MODULE_MEAN_DROP) reasons.push(`scorer module ${name} fell ${round(moduleMean(baseline, name))} → ${round(moduleMean(candidate, name))}`);
  }
  if (candidate.summary.totalAttempts > baseline.summary.totalAttempts) reasons.push(`more draft attempts (${baseline.summary.totalAttempts} → ${candidate.summary.totalAttempts})`);
  return { pass: reasons.length === 0, reasons };
}

export function judgeVerdict(artifact: Artifact): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const brief of artifact.briefs) {
    if (brief.judgeScore != null && brief.workflowScore != null && Math.abs(brief.judgeScore - brief.workflowScore) > MAX_JUDGE_DELTA) reasons.push(`brief #${brief.index + 1}: ${brief.workflowScore} vs judge ${brief.judgeScore}`);
  }
  if ((artifact.summary.meanJudgeDelta ?? 0) > MAX_JUDGE_MEAN_DELTA) reasons.push(`mean |Δ| ${artifact.summary.meanJudgeDelta} > ${MAX_JUDGE_MEAN_DELTA}`);
  return { pass: reasons.length === 0, reasons };
}

function gitSha(): string | null {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help")) {
    console.log("bench  [--label name] [--only N] [--brief N] [--autofix] [--judge-model id] [--keep]\n       --dump-brief <projectId>      freeze a real project's inputs as a brief\n       --compare <baseline.json> <candidate.json>");
    return;
  }
  const dump = flagValue(argv, "dump-brief");
  if (dump) return dumpBrief(dump);

  const compareAt = argv.indexOf("--compare");
  if (compareAt !== -1) {
    const [a, b] = [argv[compareAt + 1], argv[compareAt + 2]];
    if (!a || !b) throw new Error("--compare needs two artifact paths: baseline then candidate.");
    const baseline = JSON.parse(await readFile(a, "utf8")) as Artifact;
    const candidate = JSON.parse(await readFile(b, "utf8")) as Artifact;
    printRun(baseline);
    printRun(candidate);
    const verdict = compareRuns(baseline, candidate);
    console.log(verdict.pass ? "\nPASS — the candidate holds quality under the bench rule." : `\nFAIL — ${verdict.reasons.join("; ")}`);
    process.exitCode = verdict.pass ? 0 : 1;
    return;
  }

  const briefs = await loadBriefs();
  if (!briefs.length) throw new Error(`No briefs in ${BRIEFS_PATH}. Freeze some with --dump-brief <projectId>.`);
  const only = Number(flagValue(argv, "only")) || briefs.length;
  const judgeModel = flagValue(argv, "judge-model");
  const autofix = argv.includes("--autofix");
  // Set explicitly both ways so a bench run never inherits the machine's setting.
  process.env.SCRIPT_AUTOFIX = autofix ? "on" : "off";
  const label = flagValue(argv, "label") ?? "run";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  const results: BriefResult[] = [];
  // Sequential on purpose: the cost window per brief is only clean one at a time.
  const single = Number(flagValue(argv, "brief")) || 0; // 1-based: run just that brief
  for (let index = 0; index < Math.min(only, briefs.length); index += 1) {
    if (single && index !== single - 1) continue;
    console.log(`Brief ${index + 1}/${briefs.length} · ${briefs[index]!.title}`);
    results.push(await runBrief(briefs[index]!, index, stamp, { judgeModel, keep: argv.includes("--keep") }));
  }
  const artifact: Artifact = {
    label, createdAt: new Date().toISOString(), gitSha: gitSha(),
    versions: { draft: SCRIPT_DRAFT_PROMPT_VERSION, audit: SCRIPT_WORKFLOW_AUDIT_PROMPT_VERSION },
    models: Object.fromEntries(["script_studio_draft", "script_workflow_audit", "script_workflow_fix"].map((feature) => [feature, modelFor(feature)])),
    autofix, judgeModel, briefs: results, summary: summarise(results),
  };
  await mkdir(OUT_DIR, { recursive: true });
  // Underscores only: .gitignore drops "*-*-*.json" (a guard against committed key files).
  const out = path.join(OUT_DIR, `${stamp}_${label.replace(/[^a-z0-9]+/gi, "_")}.json`);
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`);
  printRun(artifact);
  if (judgeModel) {
    const verdict = judgeVerdict(artifact);
    console.log(verdict.pass ? `\nJUDGE PASS — ${judgeModel} scores the same documents within tolerance.` : `\nJUDGE FAIL — ${verdict.reasons.join("; ")}`);
  }
  console.log(`\nWrote ${out}`);
}
