// Shared plumbing for the miner:* runners: flag parsing, the concurrency-lane
// loop (per-item try/catch, counters, exit code), and stage selection over the
// CorpusAdState view. Every runner is a plain tsx script — no agent, no queue.

import type { CompetitorAdRow } from "../../src/lib/database.types";
import { selectStageRows } from "../../src/lib/cellumove/corpus/queue";
import { loadCompetitorAds, loadCorpusState } from "../../src/lib/cellumove/corpus/state.server";

export type MinerArgs = {
  force: boolean;
  dryRun: boolean;
  withVideo: boolean;
  skipGate: boolean;
  retryReview: boolean;
  noMedia: boolean;
  runMissing: boolean;
  commit: boolean;
  limit: number | null;
  concurrency: number | null;
  ads: string[];
  brand: string | null;
  taxonomy: string | null;
  baseline: string | null;
  version: string | null;
  perBrand: number | null;
  maxPages: number | null;
  minSupport: number | null;
  status: "active" | "all" | null;
  until: string | null;
  out: string | null;
  positional: string[];
};

function intFlag(value: string | undefined, name: string): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer (got "${value}").`);
  return parsed;
}

export function parseMinerArgs(argv: string[] = process.argv.slice(2)): MinerArgs {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (inline != null) {
      flags.set(name!, inline);
      continue;
    }
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      flags.set(name!, next);
      i += 1;
    } else {
      flags.set(name!, true);
    }
  }
  const str = (name: string): string | null => {
    const value = flags.get(name);
    return typeof value === "string" ? value : null;
  };
  const bool = (name: string): boolean => flags.has(name);
  const status = str("status");
  if (status && status !== "active" && status !== "all") throw new Error('--status must be "active" or "all".');
  return {
    force: bool("force"),
    dryRun: bool("dry-run"),
    withVideo: bool("with-video"),
    skipGate: bool("skip-gate"),
    retryReview: bool("retry-review"),
    noMedia: bool("no-media"),
    runMissing: bool("run-missing"),
    commit: bool("commit"),
    limit: intFlag(str("limit") ?? undefined, "limit"),
    concurrency: intFlag(str("concurrency") ?? undefined, "concurrency"),
    ads: (str("ad") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    brand: str("brand"),
    taxonomy: str("taxonomy"),
    baseline: str("baseline"),
    version: str("version"),
    perBrand: intFlag(str("per-brand") ?? undefined, "per-brand"),
    maxPages: intFlag(str("max-pages") ?? undefined, "max-pages"),
    minSupport: intFlag(str("min-support") ?? undefined, "min-support"),
    status: status as MinerArgs["status"],
    until: str("until"),
    out: str("out"),
    positional,
  };
}

export type LaneOutcome = "ok" | "skip";
export type LaneSummary = { ok: number; skipped: number; failed: number; errors: Array<{ label: string; message: string }> };

/**
 * Run `worker` over `items` on N lanes. A failure is printed, counted, and
 * never stops the other lanes; the process exit code becomes 1 at the end.
 */
export async function runLanes<T>(
  items: T[],
  concurrency: number,
  label: (item: T) => string,
  worker: (item: T) => Promise<LaneOutcome | string>,
): Promise<LaneSummary> {
  const summary: LaneSummary = { ok: 0, skipped: 0, failed: 0, errors: [] };
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item === undefined) break;
      const name = label(item);
      try {
        const outcome = await worker(item);
        if (outcome === "skip") {
          summary.skipped += 1;
          console.log(`—  ${name}`);
        } else {
          summary.ok += 1;
          console.log(`✓  ${name}${outcome === "ok" ? "" : ` — ${outcome}`}`);
        }
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({ label: name, message });
        console.error(`✗  ${name}: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, lane));
  if (summary.failed) process.exitCode = 1;
  return summary;
}

export function printSummary(stage: string, summary: LaneSummary): void {
  console.log(`\n${stage}: ${summary.ok} done · ${summary.skipped} skipped · ${summary.failed} failed`);
}

/** Turn the PostgREST "table missing" error into the instruction the user needs. */
export function explainFatal(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/PGRST205|schema cache|relation .* does not exist|Could not find the table/i.test(message)) {
    return `${message}\n\nThe corpus tables are missing — apply migrations/017_corpus_miner.sql (Supabase SQL editor or MCP apply_migration), then retry.`;
  }
  return message;
}

export function fail(error: unknown): never {
  console.error(explainFatal(error));
  process.exit(1);
}

export type StageName = "media" | "transcribe" | "extract";

/** The ads a stage should process — the same rule the /miner/run page uses (corpus/queue.ts). */
export async function selectAdsForStage(stage: StageName, args: MinerArgs): Promise<CompetitorAdRow[]> {
  const state = await loadCorpusState();
  const selected = selectStageRows(stage, state.rows, { force: args.force, retryReview: args.retryReview, ids: args.ads, brand: args.brand, limit: args.limit });
  if (!selected.length) return [];
  const ads = await loadCompetitorAds({ ids: selected.map((row) => row.id) });
  const order = new Map(selected.map((row, index) => [row.id, index]));
  return ads.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function usd(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toFixed(3)}`;
}

export function usageCost(usage: unknown): number | null {
  if (usage && typeof usage === "object" && "estimatedCostUsd" in usage) {
    const value = (usage as { estimatedCostUsd?: unknown }).estimatedCostUsd;
    return typeof value === "number" ? value : null;
  }
  return null;
}
