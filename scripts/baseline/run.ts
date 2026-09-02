// The end-to-end baseline: drives one idea all the way to a script sitting in an
// editor's queue, timing every stage.
//
// It calls the REAL server actions and createScriptProjectCore rather than
// re-implementing the chain, so the number stays true as the pipeline changes.
// That is only possible because ./next-runtime-stubs has already patched the
// Next-only module boundary — which is why this file is never imported directly
// from the entry point, only after the stubs are installed.

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { setSessionToken } from "./next-runtime-stubs";
import {
  addUsage,
  emptyUsage,
  renderReport,
  writeArtifact,
  type BaselineRun,
  type LedgerEntry,
  type StageResult,
  type SubStageResult,
  type UsageRollup,
} from "./report";

import { createAngle } from "@/app/actions/angles";
import { createProduct } from "@/app/actions/products";
import {
  researchSubAvatars,
  saveResearchedSubAvatar,
  type ResearchedAvatarDraft,
} from "@/app/actions/research";
import {
  assignScriptProjectToEditor,
  claimScriptProject,
  sendScriptProjectToEditor,
} from "@/app/actions/scripts";
import { mineVerbatims } from "@/app/actions/verbatims";
import { requireStrategist } from "@/lib/authorization";
import { createScriptProjectCore } from "@/lib/cellumove/create-script-project.server";
import { SCRIPT_FORMATS, inspectScriptQuality, parseScriptDocument, type ScriptDocument } from "@/lib/cellumove/script-studio";
import type {
  AngleRow,
  AppUserRow,
  ProductRow,
  ReferenceFormatRow,
  ScriptProjectRow,
  SubAvatarRow,
} from "@/lib/database.types";
import { newId, supabase, unwrap, unwrapOpt } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import type { Role } from "@/lib/roles";
import { signSession } from "@/lib/session";

const DEFAULT_IDEA =
  "A short UGC ad for compression leggings that opens on the moment someone notices their legs feel heavy at the end of a long shift, then shows how the graduated knit supports tired legs through the rest of the day.";

// The angle NAME is what buildVerifiedVerbatimQueries searches YouTube with, so
// it has to read like a real topic — a run-tagged name returns zero results and
// silently costs you the verbatim stage. The run tag goes in the slug instead,
// which createAngle accepts explicitly and which nothing searches on.
const DEFAULT_ANGLE = {
  name: "Heavy Legs After Long Shifts",
  requiredKeyword: "heavy legs",
  mechanism: "graduated compression knit that supports circulation in tired, heavy legs",
} as const;

// Tables the preflight counts, and the order cleanup deletes in. AppUser is
// deliberately absent from the delete order: the two baseline accounts are
// reused across runs and are referenced by earlier runs' projects.
const COUNT_TABLES = [
  "Product",
  "Angle",
  "SubAvatar",
  "AvatarResearch",
  "Verbatim",
  "ReferenceFormat",
  "AppUser",
  "ScriptProject",
  "ScriptAssignment",
  "BrollClip",
  "Usage",
] as const;

const DELETE_ORDER = [
  "ScriptEvent",
  "ScriptSource",
  "ScriptAssignment",
  "ScriptVersion",
  "ScriptProject",
  "Verbatim",
  "ResearchFeedback",
  "ResearchEvidence",
  "ResearchSource",
  "Research",
  "AvatarResearch",
  "SubAvatar",
  "Angle",
  "Product",
] as const;

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_SECRET",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  "YOUTUBE_API_KEY",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
] as const;

// Ordered so the generation sub-stage table reads in pipeline order rather than
// first-seen order.
const GENERATION_STAGE_ORDER = [
  "setup",
  "resources",
  "retrieval",
  "model",
  "validation",
  "persistence",
  "complete",
] as const;

// Minimal, weakening substitutions for the claim check that hard-blocks handoff.
// Order matters: the multi-word phrases must run before the single words they
// contain. Every applied edit is recorded verbatim in the artifact.
const CLAIM_REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bclinically proven\b/gi, "lab-tested"],
  [/\beliminate(?:s|d)? cellulite\b/gi, "smooths the look of cellulite"],
  [/\bguaranteed\b/gi, "expected"],
  [/\bguarantee\b/gi, "aim"],
  [/\bcure\b/gi, "support"],
];

interface Flags {
  product: string | null;
  angle: string | null;
  subAvatar: string | null;
  framework: string | null;
  skipResearch: boolean;
  skipVerbatims: boolean;
  idea: string;
  focus: string | null;
  duration: number | null;
  format: string;
  targetVerbatims: number;
  overrideQuality: boolean;
  claimFix: boolean;
  throughClaim: boolean;
  strategist: string;
  editor: string;
  cleanup: boolean;
  cleanupOnly: string | null;
  json: string | null;
  writeJson: boolean;
  dryRun: boolean;
  help: boolean;
}

interface StageOutcome<T> {
  value: T;
  summary: string;
  subStages?: SubStageResult[];
  notes?: Record<string, unknown>;
  /** When set, the stage is recorded as `blocked` and dependants are skipped. */
  blocked?: string;
}

interface TimedProgressEvent {
  stage: string;
  level: string;
  message: string;
  detail?: string;
  atMs: number;
}

const stages: StageResult[] = [];
const warnings: string[] = [];
const ledger: LedgerEntry[] = [];
const totalUsage = emptyUsage();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
}

/**
 * A delete whose match column is only known at runtime. The generated Database
 * type keys `.eq()` to each table's own columns, which a loop over mixed tables
 * cannot satisfy; the widening is contained to this one helper.
 */
async function deleteWhere(table: string, column: string, value: string): Promise<string | null> {
  const query = supabase.from(table as (typeof COUNT_TABLES)[number]).delete() as unknown as {
    eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
  };
  const result = await query.eq(column, value);
  return result.error ? result.error.message : null;
}

function parseFlags(argv: string[]): Flags {
  const { values } = parseArgs({
    args: argv,
    options: {
      product: { type: "string" },
      angle: { type: "string" },
      "sub-avatar": { type: "string" },
      framework: { type: "string" },
      "skip-research": { type: "boolean", default: false },
      "skip-verbatims": { type: "boolean", default: false },
      idea: { type: "string" },
      focus: { type: "string" },
      duration: { type: "string" },
      format: { type: "string" },
      "target-verbatims": { type: "string" },
      "override-quality": { type: "boolean", default: false },
      "no-claim-fix": { type: "boolean", default: false },
      "through-claim": { type: "boolean", default: false },
      strategist: { type: "string" },
      editor: { type: "string" },
      cleanup: { type: "boolean", default: false },
      "cleanup-only": { type: "string" },
      json: { type: "string" },
      "no-json": { type: "boolean", default: false },
      // `--plan` is the one that survives npm: npm consumes `--dry-run` as its
      // own global flag, even after `--`, so it never reaches argv here.
      plan: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const duration = values.duration ? Number.parseInt(values.duration, 10) : null;
  if (duration !== null && (!Number.isFinite(duration) || duration < 5 || duration > 600)) {
    throw new Error("--duration must be an integer between 5 and 600.");
  }
  const targetVerbatims = values["target-verbatims"] ? Number.parseInt(values["target-verbatims"], 10) : 24;
  if (!Number.isFinite(targetVerbatims) || targetVerbatims < 4 || targetVerbatims > 60) {
    throw new Error("--target-verbatims must be an integer between 4 and 60.");
  }
  const format = values.format ?? "UGC";
  if (!SCRIPT_FORMATS.includes(format as (typeof SCRIPT_FORMATS)[number])) {
    throw new Error(`--format must be one of: ${SCRIPT_FORMATS.join(", ")}`);
  }
  if (values["skip-research"] && !values["sub-avatar"]) {
    throw new Error("--skip-research needs --sub-avatar <id>: generation has to run against a researched avatar.");
  }

  return {
    product: values.product ?? null,
    angle: values.angle ?? null,
    subAvatar: values["sub-avatar"] ?? null,
    framework: values.framework ?? null,
    skipResearch: Boolean(values["skip-research"]),
    skipVerbatims: Boolean(values["skip-verbatims"]),
    idea: values.idea ?? DEFAULT_IDEA,
    focus: values.focus ?? null,
    duration,
    format,
    targetVerbatims,
    overrideQuality: Boolean(values["override-quality"]),
    claimFix: !values["no-claim-fix"],
    throughClaim: Boolean(values["through-claim"]),
    strategist: (values.strategist ?? "baseline-strategist").toLowerCase(),
    editor: (values.editor ?? "baseline-editor").toLowerCase(),
    cleanup: Boolean(values.cleanup),
    cleanupOnly: values["cleanup-only"] ?? null,
    json: values.json ?? null,
    writeJson: !values["no-json"],
    dryRun: Boolean(values.plan) || Boolean(values["dry-run"]),
    help: Boolean(values.help),
  };
}

function printHelp(): void {
  console.log(`
  Baseline the end-to-end time (idea -> shipped script).

  Usage
    npm run baseline:e2e                                   full run, no flags
    npx tsx --env-file=.env scripts/baseline-end-to-end.ts [flags]

  Pass flags through tsx, not npm. npm claims some of them for itself (and
  PowerShell drops the "--" separator), so they silently never arrive.

  Reuse instead of creating
    --product <id|code>      --angle <slug>        --sub-avatar <id>
    --framework <slug>

  Scope
    --skip-research          requires --sub-avatar
    --skip-verbatims
    --through-claim          also time the editor claiming the script

  Inputs
    --idea "<text>"          --focus "<text>"      --duration <seconds>
    --format <name>          --target-verbatims <n>
    --strategist <username>  --editor <username>

  Behaviour
    --override-quality       save a research draft that failed the evidence gate
    --no-claim-fix           report a claim block instead of redacting and sending
    --plan                   preflight and the resolved plan only; no writes, no AI
                             (use --plan, not --dry-run: npm eats --dry-run itself)

  Output and cleanup
    --json <path>            --no-json
    --cleanup                delete this run's rows after reporting
    --cleanup-only <file>    delete a prior run's rows from its artifact

  The fast iteration loop is:
    npm run baseline:e2e -- --sub-avatar <id> --skip-research --skip-verbatims
`);
}

function installConsoleTee(sink: string[]): () => void {
  const originalWarn = console.warn;
  const originalError = console.error;
  const format = (args: unknown[]): string =>
    args
      .map((arg) => {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  console.warn = (...args: unknown[]) => {
    sink.push(format(args));
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    sink.push(format(args));
    originalError(...args);
  };
  return () => {
    console.warn = originalWarn;
    console.error = originalError;
  };
}

/**
 * Tokens and cost billed inside a stage's window.
 *
 * `recordUsage` stamps `createdAt` after the model call returns, on this same
 * machine, so bucketing by window is accurate — but it says nothing about how
 * long any individual call took, and it is fail-soft, so a row can be missing
 * entirely. Concurrent use of the app during a run also lands in the window.
 */
async function usageBetween(startIso: string): Promise<UsageRollup> {
  const rollup = emptyUsage();
  try {
    const result = await supabase
      .from("Usage")
      .select("feature,model,inputTokens,outputTokens,thinkingTokens,estimatedCostUsd")
      .gte("createdAt", startIso)
      .lte("createdAt", new Date().toISOString());
    if (result.error) {
      warnings.push(`[baseline] usage query failed: ${result.error.message}`);
      return rollup;
    }
    for (const row of (result.data ?? []) as Array<{
      feature: string;
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      estimatedCostUsd: number;
    }>) {
      rollup.calls += 1;
      rollup.inputTokens += row.inputTokens ?? 0;
      rollup.outputTokens += row.outputTokens ?? 0;
      rollup.thinkingTokens += row.thinkingTokens ?? 0;
      rollup.costUsd += row.estimatedCostUsd ?? 0;
      const current = rollup.byFeature[row.feature] ?? { calls: 0, costUsd: 0 };
      current.calls += 1;
      current.costUsd += row.estimatedCostUsd ?? 0;
      rollup.byFeature[row.feature] = current;
    }
  } catch (error) {
    warnings.push(`[baseline] usage query threw: ${messageOf(error)}`);
  }
  return rollup;
}

/**
 * Runs one stage and records it. Never throws: a failure is a measurement, and
 * the report must survive it. Stages listed in `dependsOn` that did not finish
 * `ok` skip this one instead.
 */
async function runStage<T>(
  name: string,
  options: { dependsOn?: string[]; skip?: string | null },
  fn: () => Promise<StageOutcome<T>>,
): Promise<T | null> {
  const failedDependency = (options.dependsOn ?? []).find(
    (dependency) => stages.find((stage) => stage.name === dependency)?.status !== "ok",
  );
  const skipReason = options.skip ?? (failedDependency ? `depends on ${failedDependency}` : null);
  if (skipReason) {
    stages.push({ name, status: "skipped", startedAtIso: new Date().toISOString(), ms: 0, summary: skipReason });
    return null;
  }

  const startedAtIso = new Date().toISOString();
  const started = performance.now();
  // A heartbeat rather than a timeout: none of these calls accept an
  // AbortSignal, so racing a timer would leave the real work running invisibly
  // while claiming it had been cancelled.
  const heartbeat = setInterval(() => {
    process.stdout.write(`    ... ${name} ${Math.round((performance.now() - started) / 1000)}s\n`);
  }, 15_000);
  heartbeat.unref();

  try {
    const outcome = await fn();
    const ms = performance.now() - started;
    clearInterval(heartbeat);
    const usage = await usageBetween(startedAtIso);
    addUsage(totalUsage, usage);
    stages.push({
      name,
      status: outcome.blocked ? "blocked" : "ok",
      startedAtIso,
      ms,
      summary: outcome.blocked ?? outcome.summary,
      notes: outcome.notes,
      subStages: outcome.subStages,
      usage,
    });
    return outcome.value;
  } catch (error) {
    const ms = performance.now() - started;
    clearInterval(heartbeat);
    const usage = await usageBetween(startedAtIso);
    addUsage(totalUsage, usage);
    stages.push({ name, status: "failed", startedAtIso, ms, error: messageOf(error), usage });
    return null;
  }
}

/**
 * Find-or-create by username, so reruns reuse the same two accounts.
 *
 * With `persist` false (a dry run) a missing account is built in memory and not
 * written — a dry run that seeded rows would be lying about being read-only.
 */
async function ensureAppUser(
  username: string,
  role: Role,
  shortCode: string,
  persist: boolean,
): Promise<{ user: AppUserRow; existed: boolean }> {
  const existing = unwrapOpt(
    await supabase.from("AppUser").select("*").eq("username", username).maybeSingle(),
  ) as AppUserRow | null;
  if (existing) {
    if (existing.role !== role) {
      throw new Error(`AppUser "${username}" has role "${existing.role}", but the baseline needs "${role}".`);
    }
    return { user: existing, existed: true };
  }
  const row: AppUserRow = {
    id: newId(),
    username,
    shortCode,
    // Never signed into: the baseline mints its own session token. A random
    // secret keeps the row from being a usable back door.
    passwordHash: await hashPassword(randomBytes(24).toString("hex")),
    role,
    createdAt: new Date().toISOString(),
  };
  if (persist) unwrap(await supabase.from("AppUser").insert(row).select("id").single());
  return { user: row, existed: false };
}

async function actAs(user: AppUserRow): Promise<void> {
  setSessionToken(await signSession({ uid: user.id, username: user.username, role: user.role as Role }));
}

function redactClaims(document: ScriptDocument): {
  document: ScriptDocument;
  fixes: Array<{ moduleId: string; field: string; before: string; after: string }>;
} {
  const fixes: Array<{ moduleId: string; field: string; before: string; after: string }> = [];
  const modules = document.modules.map((module) => {
    let spokenText = module.spokenText;
    let onScreenText = module.onScreenText;
    for (const [pattern, replacement] of CLAIM_REDACTIONS) {
      spokenText = spokenText.replace(pattern, replacement);
      onScreenText = onScreenText.replace(pattern, replacement);
    }
    if (spokenText !== module.spokenText) {
      fixes.push({ moduleId: module.id, field: "spokenText", before: module.spokenText, after: spokenText });
    }
    if (onScreenText !== module.onScreenText) {
      fixes.push({ moduleId: module.id, field: "onScreenText", before: module.onScreenText, after: onScreenText });
    }
    return { ...module, spokenText, onScreenText };
  });
  return { document: { ...document, modules }, fixes };
}

/**
 * Turns the generation progress stream into per-stage durations.
 *
 * Each event's elapsed time is charged to the stage that was active when it
 * fired, so the sub-stages add up to the stage total instead of overlapping.
 */
function summariseProgress(
  events: TimedProgressEvent[],
  totalMs: number,
): { subStages: SubStageResult[]; attempts: number; retrievalMode: string | null; brollLoaded: number | null } {
  const durations = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    if (!current) continue;
    const next = events[index + 1];
    const until = next ? next.atMs : totalMs;
    const previousEnd = index === 0 ? 0 : current.atMs;
    const charged = Math.max(0, until - previousEnd);
    durations.set(current.stage, (durations.get(current.stage) ?? 0) + charged);
  }

  const attempts = events.filter(
    (event) => event.stage === "model" && event.level === "info" && event.message.includes("attempt"),
  ).length;

  const retrievalOutcome = events.find(
    (event) => event.stage === "retrieval" && (event.level === "success" || event.level === "warning"),
  );
  const retrievalMode = retrievalOutcome ? (retrievalOutcome.level === "success" ? "hybrid" : "keyword fallback") : null;

  const resourceDetail = events.find((event) => event.stage === "resources" && event.level === "success")?.detail ?? "";
  const brollMatch = /(\d+)\s+B-roll clips/i.exec(resourceDetail);
  const brollLoaded = brollMatch?.[1] ? Number.parseInt(brollMatch[1], 10) : null;

  const rejections = events.filter(
    (event) => event.stage === "validation" && event.message.startsWith("Draft rejected"),
  ).length;

  const subStages: SubStageResult[] = [];
  for (const stageName of GENERATION_STAGE_ORDER) {
    const ms = durations.get(stageName);
    if (ms === undefined) continue;
    let note: string | undefined;
    if (stageName === "model") note = `${attempts} attempt${attempts === 1 ? "" : "s"}`;
    if (stageName === "retrieval" && retrievalMode) note = retrievalMode;
    if (stageName === "validation" && rejections > 0) note = `${rejections} draft rejection${rejections === 1 ? "" : "s"}`;
    subStages.push({ name: stageName, ms, note });
  }

  return { subStages, attempts, retrievalMode, brollLoaded };
}

async function cleanupLedger(entries: readonly LedgerEntry[]): Promise<void> {
  const owned = entries.filter((entry) => entry.owned);
  if (owned.length === 0) {
    console.log("  Nothing to clean up: this run created no rows it owns.");
    return;
  }
  console.log(`  Cleaning up ${owned.length} ledger entries...`);
  for (const table of DELETE_ORDER) {
    for (const entry of owned.filter((candidate) => candidate.table === table)) {
      const error = await deleteWhere(entry.table, entry.column, entry.value);
      if (error) console.warn(`  [cleanup] ${entry.table}.${entry.column}=${entry.value}: ${error}`);
    }
  }
  console.log("  Cleanup done. The baseline AppUser rows are kept for reuse.");
}

async function cleanupFromArtifact(artifactPath: string): Promise<void> {
  const raw = await readFile(artifactPath, "utf8");
  const parsed = JSON.parse(raw) as { ledger?: LedgerEntry[] };
  if (!Array.isArray(parsed.ledger)) throw new Error(`No ledger found in ${artifactPath}.`);
  await cleanupLedger(parsed.ledger);
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export async function main(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (flags.help) {
    printHelp();
    return;
  }
  if (flags.cleanupOnly) {
    await cleanupFromArtifact(flags.cleanupOnly);
    return;
  }

  const restoreConsole = installConsoleTee(warnings);
  process.on("unhandledRejection", (reason) => {
    warnings.push(`[baseline] unhandled rejection: ${messageOf(reason)}`);
  });

  const startedAtIso = new Date().toISOString();
  const runStarted = performance.now();
  let projectId: string | null = null;
  let finalDocument: unknown = null;

  try {
    const outcome = await executePipeline(flags);
    projectId = outcome.projectId;
    finalDocument = outcome.document;
  } catch (error) {
    // Stages swallow their own failures; this only catches something thrown
    // between them, and it must not cost us the report.
    stages.push({
      name: "run",
      status: "failed",
      startedAtIso: new Date().toISOString(),
      ms: 0,
      error: messageOf(error),
    });
  } finally {
    restoreConsole();
  }

  const wallMs = performance.now() - runStarted;
  const headlineMs = stages
    .filter((stage) => stage.name !== "preflight")
    .reduce((sum, stage) => sum + stage.ms, 0);

  const run: BaselineRun = {
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    totalMs: headlineMs,
    wallMs,
    flags: { ...flags },
    env: Object.fromEntries(ENV_KEYS.map((key) => [key, Boolean(process.env[key]?.trim())])),
    versions: {
      node: process.version,
      gitSha: gitSha(),
      models: {
        default: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro",
        fast: process.env.GEMINI_FAST_MODEL?.trim() || "gemini-2.5-flash",
        embed: process.env.EMBED_MODEL?.trim() || "text-embedding-004",
      },
    },
    stages,
    usage: totalUsage,
    warnings,
    ledger,
    projectId,
    document: finalDocument,
  };

  console.log(renderReport(run));

  if (flags.writeJson && !flags.dryRun) {
    try {
      const written = await writeArtifact(run, flags.json);
      console.log(`  Artifact: ${written}\n`);
    } catch (error) {
      console.warn(`  Could not write the artifact: ${messageOf(error)}`);
    }
  }

  if (flags.cleanup) await cleanupLedger(ledger);

  const failed = stages.some((stage) => stage.status === "failed" || stage.status === "blocked");
  if (failed) process.exitCode = 1;
}

async function executePipeline(flags: Flags): Promise<{ projectId: string | null; document: unknown }> {
  const runSuffix = suffix();

  const preflight = await runStage("preflight", {}, async () => {
    const counts: Record<string, number | string> = {};
    const missing: string[] = [];
    for (const table of COUNT_TABLES) {
      const result = await supabase.from(table).select("*", { count: "exact", head: true });
      if (result.error) {
        counts[table] = `error: ${result.error.message}`;
        missing.push(table);
      } else {
        counts[table] = result.count ?? 0;
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `These tables are unreadable: ${missing.join(", ")}. Apply the matching migration in migrations/ (Script Studio is 009_script_studio.sql).`,
      );
    }
    if (counts.ReferenceFormat === 0) {
      throw new Error("No ReferenceFormat rows: run `npm run seed:sop` before baselining.");
    }

    const brollCount = typeof counts.BrollClip === "number" ? counts.BrollClip : 0;
    if (brollCount === 0) {
      warnings.push(
        "[baseline] BrollClip is empty. Generation is fail-soft on B-roll, so the script will be produced with no clips attached — the run is not measuring the B-roll path.",
      );
    }

    const verifiedResult = await supabase
      .from("Verbatim")
      .select("*", { count: "exact", head: true })
      .like("researchId", "verified:%");
    const verifiedVerbatims = verifiedResult.error ? 0 : verifiedResult.count ?? 0;

    const strategistUser = await ensureAppUser(flags.strategist, "creative_strategist", "BSL", !flags.dryRun);
    const editorUser = await ensureAppUser(flags.editor, "editor", "BED", !flags.dryRun);
    const strategist = strategistUser.user;
    const editor = editorUser.user;
    const newAccounts = [strategistUser, editorUser].filter((entry) => !entry.existed).map((entry) => entry.user.username);

    // Resolve a reused avatar here rather than at generation time: the avatar
    // must belong to the chosen angle, and finding that out five minutes in
    // instead of two seconds in wastes a whole run.
    let reusedAvatar: SubAvatarRow | null = null;
    let derivedAngle: AngleRow | null = null;
    if (flags.subAvatar) {
      reusedAvatar = unwrapOpt(
        await supabase.from("SubAvatar").select("*").eq("id", flags.subAvatar).maybeSingle(),
      ) as SubAvatarRow | null;
      if (!reusedAvatar) throw new Error(`Sub-avatar not found: ${flags.subAvatar}`);
      derivedAngle = unwrapOpt(
        await supabase.from("Angle").select("*").eq("id", reusedAvatar.angleId).maybeSingle(),
      ) as AngleRow | null;
      if (!derivedAngle) throw new Error(`Sub-avatar ${reusedAvatar.id} points at a missing angle.`);
      if (flags.angle && flags.angle !== derivedAngle.slug) {
        throw new Error(
          `--sub-avatar belongs to angle "${derivedAngle.slug}", not "${flags.angle}". Script creation would refuse the pair.`,
        );
      }
      const research = unwrapOpt(
        await supabase.from("AvatarResearch").select("subAvatarId").eq("subAvatarId", reusedAvatar.id).maybeSingle(),
      ) as { subAvatarId: string } | null;
      if (!research) {
        warnings.push(`[baseline] Sub-avatar ${reusedAvatar.id} has no AvatarResearch row; the script will be generated without an avatar profile.`);
      }
    }

    const summary = `${Object.entries(counts)
      .filter(([table]) => ["Product", "Angle", "ReferenceFormat", "BrollClip"].includes(table))
      .map(([table, value]) => `${table} ${value}`)
      .join(" | ")}${brollCount === 0 ? "  (!)" : ""}`;

    return {
      value: { strategist, editor, newAccounts, counts, brollCount, verifiedVerbatims, reusedAvatar, derivedAngle },
      summary,
      notes: { counts, verifiedVerbatims, newAccounts },
    };
  });

  if (!preflight) return { projectId: null, document: null };

  if (flags.dryRun) {
    const accountNote = (user: AppUserRow): string =>
      preflight.newAccounts.includes(user.username) ? "would be created" : user.id;
    console.log("\n  Plan only — resolved plan:");
    console.log(`    strategist       ${preflight.strategist.username} (${accountNote(preflight.strategist)})`);
    console.log(`    editor           ${preflight.editor.username} (${accountNote(preflight.editor)})`);
    console.log(`    product          ${flags.product ?? `new BASE${runSuffix}`}`);
    console.log(`    angle            ${flags.angle ?? preflight.derivedAngle?.slug ?? `new baseline-${runSuffix}`}`);
    console.log(`    avatar           ${preflight.reusedAvatar?.id ?? (flags.skipResearch ? "(none)" : "new, via AI research")}`);
    console.log(`    verbatims        ${flags.skipVerbatims ? "skipped" : `mine ${flags.targetVerbatims}`}`);
    console.log(`    framework        ${flags.framework ?? "first by order"}`);
    console.log(`    claim handling   ${flags.claimFix ? "redact and send" : "report blocked"}`);
    console.log("    No writes and no model calls were made.\n");
    return { projectId: null, document: null };
  }

  const product = await runStage("product", { dependsOn: ["preflight"] }, async () => {
    if (flags.product) {
      const byId = unwrapOpt(
        await supabase.from("Product").select("*").eq("id", flags.product).maybeSingle(),
      ) as ProductRow | null;
      const row =
        byId ??
        ((unwrapOpt(
          await supabase.from("Product").select("*").eq("code", flags.product.toUpperCase()).maybeSingle(),
        ) as ProductRow | null) ?? null);
      if (!row) throw new Error(`Product not found: ${flags.product}`);
      if (!row.code?.trim()) throw new Error(`Product ${row.id} has no naming code; script creation refuses it.`);
      ledger.push({ table: "Product", column: "id", value: row.id, owned: false, note: "reused" });
      return { value: row, summary: `${row.code} "${row.name}" (reused)` };
    }
    await actAs(preflight.strategist);
    const created = (await createProduct({
      name: `Baseline Product ${runSuffix}`,
      code: `BASE${runSuffix}`,
      description: "Created by the end-to-end baseline script.",
    })) as unknown as ProductRow;
    ledger.push({ table: "Product", column: "id", value: created.id, owned: true });
    return { value: created, summary: `${created.code} "${created.name}"` };
  });

  const angle = await runStage("angle", { dependsOn: ["product"] }, async () => {
    if (preflight.derivedAngle) {
      ledger.push({ table: "Angle", column: "id", value: preflight.derivedAngle.id, owned: false, note: "reused" });
      return { value: preflight.derivedAngle, summary: `${preflight.derivedAngle.slug} (from --sub-avatar)` };
    }
    if (flags.angle) {
      const row = unwrapOpt(
        await supabase.from("Angle").select("*").eq("slug", flags.angle).maybeSingle(),
      ) as AngleRow | null;
      if (!row) throw new Error(`Angle not found: ${flags.angle}`);
      ledger.push({ table: "Angle", column: "id", value: row.id, owned: false, note: "reused" });
      return { value: row, summary: `${row.slug} (reused)` };
    }
    const created = (await createAngle({
      name: DEFAULT_ANGLE.name,
      slug: `baseline-heavy-legs-${runSuffix.toLowerCase()}`,
      requiredKeyword: DEFAULT_ANGLE.requiredKeyword,
      mechanism: DEFAULT_ANGLE.mechanism,
      silhouette: "full-length",
      colorway: "black",
    })) as unknown as AngleRow;
    ledger.push({ table: "Angle", column: "id", value: created.id, owned: true });
    return { value: created, summary: created.slug };
  });

  const draft = await runStage<ResearchedAvatarDraft>(
    "research.generate",
    { dependsOn: ["angle"], skip: flags.skipResearch ? "--skip-research" : null },
    async () => {
      if (!angle) throw new Error("No angle.");
      const windowStart = new Date().toISOString();
      const drafts = await researchSubAvatars(angle.slug, flags.focus);

      // Research persists its own evidence ledger. Capture the rows written in
      // this window so --cleanup can undo them; best-effort, since the ids are
      // never returned to the caller.
      const researchRows = await supabase.from("Research").select("id").gte("createdAt", windowStart);
      for (const row of (researchRows.data ?? []) as Array<{ id: string }>) {
        ledger.push({ table: "ResearchFeedback", column: "researchId", value: row.id, owned: true });
        ledger.push({ table: "ResearchEvidence", column: "researchId", value: row.id, owned: true });
        ledger.push({ table: "ResearchSource", column: "researchId", value: row.id, owned: true });
        ledger.push({ table: "Research", column: "id", value: row.id, owned: true });
      }

      if (drafts.length === 0) throw new Error("Research returned no avatar drafts.");
      const best = [...drafts].sort((a, b) => (b.quality?.score ?? 0) - (a.quality?.score ?? 0))[0];
      if (!best) throw new Error("Research returned no avatar drafts.");
      return {
        value: best,
        summary: `${drafts.length} drafts | best ${best.quality?.status ?? "unrated"} ${best.quality?.score ?? "?"}/100 | ${best.sources.length} sources | profile ${best.profile ? "yes" : "no"}`,
        notes: {
          draftCount: drafts.length,
          quality: best.quality ?? null,
          verification: best.verification ?? null,
          hasProfile: Boolean(best.profile),
        },
      };
    },
  );

  const avatar = await runStage<SubAvatarRow | null>(
    "research.save",
    { dependsOn: ["research.generate"], skip: flags.skipResearch ? "--skip-research" : null },
    async () => {
      if (!angle || !draft) throw new Error("No research draft to save.");
      // The evidence gate is a product decision, not a fault: surface it as a
      // blocked stage with the way out, rather than a stack trace.
      if (draft.quality?.status === "reject" && !flags.overrideQuality) {
        const blockers = draft.quality.blockers.slice(0, 2).join("; ") || "no reason given";
        return {
          value: null,
          summary: "",
          blocked: `evidence gate rejected the best draft (${draft.quality.score}/100): ${blockers}. Rerun with --override-quality to save it anyway.`,
          notes: { quality: draft.quality },
        };
      }
      const { subAvatarId } = await saveResearchedSubAvatar({
        angleSlug: angle.slug,
        draft,
        overrideQuality: flags.overrideQuality,
      });
      ledger.push({ table: "AvatarResearch", column: "subAvatarId", value: subAvatarId, owned: true });
      ledger.push({ table: "SubAvatar", column: "id", value: subAvatarId, owned: true });
      const row = unwrapOpt(
        await supabase.from("SubAvatar").select("*").eq("id", subAvatarId).maybeSingle(),
      ) as SubAvatarRow | null;
      if (!row) throw new Error("Saved sub-avatar could not be read back.");
      return { value: row, summary: `${row.name} (${row.slug})` };
    },
  );

  const subAvatar = avatar ?? preflight.reusedAvatar;

  await runStage(
    "verbatims",
    {
      dependsOn: ["angle"],
      skip: flags.skipVerbatims ? "--skip-verbatims" : !subAvatar ? "no avatar to mine for" : null,
    },
    async () => {
      if (!subAvatar) throw new Error("No avatar.");
      const result = await mineVerbatims({
        subAvatarId: subAvatar.id,
        focus: flags.focus,
        targetCount: flags.targetVerbatims,
      });
      ledger.push({ table: "Verbatim", column: "subAvatarId", value: subAvatar.id, owned: true });
      return {
        value: result,
        summary: `${result.count} saved | ${result.duplicatesSkipped} dupes | ${result.rejectedByQuality} rejected`,
        notes: { ...result },
      };
    },
  );

  const framework = await runStage<ReferenceFormatRow>("framework", { dependsOn: ["preflight"] }, async () => {
    const query = supabase.from("ReferenceFormat").select("*").order("order", { ascending: true });
    const result = flags.framework ? await query.eq("slug", flags.framework) : await query.limit(1);
    if (result.error) throw new Error(result.error.message);
    const row = ((result.data ?? []) as ReferenceFormatRow[])[0];
    if (!row) throw new Error(flags.framework ? `Framework not found: ${flags.framework}` : "No ReferenceFormat rows.");
    ledger.push({ table: "ReferenceFormat", column: "id", value: row.id, owned: false, note: "reused" });
    return { value: row, summary: row.slug };
  });

  const generated = await runStage<{ projectId: string; document: ScriptDocument }>(
    "script.generate",
    { dependsOn: ["product", "angle", "framework"] },
    async () => {
      if (!product || !angle || !framework) throw new Error("Missing creative resources.");
      const actor = await requireStrategist();
      const targetDurationSec = flags.duration ?? framework.optimalDurationSec ?? 30;

      const events: TimedProgressEvent[] = [];
      const started = performance.now();
      const { id } = await createScriptProjectCore(
        {
          title: `Baseline ${runSuffix}`,
          idea: flags.idea,
          adNumber: `B${runSuffix}`,
          creativeName: `Baseline ${runSuffix}`,
          productId: product.id,
          angleId: angle.id,
          subAvatarId: subAvatar?.id ?? null,
          referenceFormatId: framework.id,
          strategistUserId: preflight.strategist.id,
          // Left null on purpose: passing an editor here starts the assignment
          // as "assigned", which makes the assign stage throw. The real UI
          // assigns after handoff.
          editorUserId: null,
          format: flags.format,
          targetDurationSec,
        },
        {
          actor,
          onProgress: (event) => {
            events.push({ ...event, atMs: performance.now() - started });
          },
        },
      );
      const elapsed = performance.now() - started;

      ledger.push({ table: "ScriptEvent", column: "projectId", value: id, owned: true });
      ledger.push({ table: "ScriptSource", column: "projectId", value: id, owned: true });
      ledger.push({ table: "ScriptAssignment", column: "projectId", value: id, owned: true });
      ledger.push({ table: "ScriptVersion", column: "projectId", value: id, owned: true });
      ledger.push({ table: "ScriptProject", column: "id", value: id, owned: true });

      const project = unwrapOpt(
        await supabase.from("ScriptProject").select("*").eq("id", id).maybeSingle(),
      ) as ScriptProjectRow | null;
      if (!project) throw new Error("The created script project could not be read back.");
      const document = parseScriptDocument(project.document);

      const { subStages, attempts, retrievalMode, brollLoaded } = summariseProgress(events, elapsed);
      const brollRefs = document.modules.filter((module) => module.brollRefs.length > 0).length;
      const sourceCount = await supabase
        .from("ScriptSource")
        .select("*", { count: "exact", head: true })
        .eq("projectId", id);

      if (elapsed > 600_000) {
        warnings.push(
          `[baseline] script generation took ${Math.round(elapsed / 1000)}s. The /api/scripts/generate route caps at maxDuration = 600, so this would have timed out in production.`,
        );
      }

      return {
        value: { projectId: id, document },
        summary: `${attempts} model attempt${attempts === 1 ? "" : "s"} | ${document.modules.length} modules | ${document.hookAlternatives.length} hooks | ${brollRefs} beats with b-roll`,
        subStages,
        notes: {
          projectId: id,
          modelAttempts: attempts,
          retrievalMode,
          brollClipsOffered: brollLoaded,
          brollClipsInLibrary: preflight.brollCount,
          modulesWithBroll: brollRefs,
          hookAlternatives: document.hookAlternatives.length,
          selectedHookId: document.selectedHookId,
          scriptSources: sourceCount.error ? null : sourceCount.count ?? 0,
          events,
        },
      };
    },
  );

  const sent = await runStage<ScriptDocument>("send", { dependsOn: ["script.generate"] }, async () => {
    if (!generated) throw new Error("No script project.");
    const issues = inspectScriptQuality(generated.document);
    const blocking = issues.filter((issue) => issue.severity === "error");
    const warningIssues = issues.filter((issue) => issue.severity === "warning");

    let document = generated.document;
    let fixes: Array<{ moduleId: string; field: string; before: string; after: string }> = [];

    if (blocking.length > 0) {
      if (!flags.claimFix) {
        return {
          value: document,
          summary: "",
          blocked: `claim check: "${blocking[0]?.message}" (${blocking.length} module${blocking.length === 1 ? "" : "s"}); --no-claim-fix is set`,
          notes: { blocking, warnings: warningIssues },
        };
      }
      const redacted = redactClaims(document);
      document = redacted.document;
      fixes = redacted.fixes;
      const stillBlocking = inspectScriptQuality(document).filter((issue) => issue.severity === "error");
      if (stillBlocking.length > 0) {
        return {
          value: document,
          summary: "",
          blocked: `claim check still blocking after redaction: "${stillBlocking[0]?.message}"`,
          notes: { blocking, stillBlocking, claimFixesApplied: fixes },
        };
      }
    }

    await sendScriptProjectToEditor({ projectId: generated.projectId, expectedRevision: 0, document });
    const summary = fixes.length
      ? `${fixes.length} claim fix${fixes.length === 1 ? "" : "es"} applied before it could ship | ${warningIssues.length} warnings`
      : `clean first draft | ${warningIssues.length} warnings`;
    return {
      value: document,
      summary,
      notes: { claimFixesApplied: fixes, blocking, warnings: warningIssues },
    };
  });

  await runStage("assign", { dependsOn: ["send"] }, async () => {
    if (!generated) throw new Error("No script project.");
    await assignScriptProjectToEditor({
      projectId: generated.projectId,
      editorUserId: preflight.editor.id,
    });
    return { value: null, summary: preflight.editor.username };
  });

  await runStage(
    "claim",
    { dependsOn: ["assign"], skip: flags.throughClaim ? null : "--through-claim not set" },
    async () => {
      if (!generated) throw new Error("No script project.");
      await actAs(preflight.editor);
      await claimScriptProject(generated.projectId);
      await actAs(preflight.strategist);
      return { value: null, summary: `claimed by ${preflight.editor.username}` };
    },
  );

  return { projectId: generated?.projectId ?? null, document: sent ?? generated?.document ?? null };
}
