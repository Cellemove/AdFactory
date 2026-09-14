// Which ads a per-ad stage should process next. One rule shared by the CLI
// runners and the /miner/run page, so both always agree on "ready".
//
// A stage takes ads that finished the previous stage and not this one, or
// everything eligible with `force`. Explicit ids bypass the stage check (the
// stage itself then reports what is missing). Pure: works on CorpusAdState rows.

import type { AdTeardownRow, CorpusAdStateRow } from "@/lib/database.types";
import { defaultWinnerCount, pickWinners } from "./teardown";

export const AD_STAGES = ["media", "transcribe", "extract", "teardown"] as const;
export type AdStage = (typeof AD_STAGES)[number];

export type QueueOptions = {
  force?: boolean;
  /** extract: include ads the evidence gate quarantined. */
  retryReview?: boolean;
  ids?: string[];
  brand?: string | null;
  limit?: number | null;
};

function inScope(rows: CorpusAdStateRow[], options: QueueOptions): CorpusAdStateRow[] {
  let out = rows.filter((row) => row.mediaType === "video" && row.corpusIncluded);
  if (options.brand) out = out.filter((row) => row.brandName.toLowerCase() === options.brand!.toLowerCase());
  return out;
}

export function isReadyFor(stage: Exclude<AdStage, "teardown">, row: CorpusAdStateRow, options: QueueOptions = {}): boolean {
  if (stage === "media") return row.mediaStatus !== "downloaded";
  if (stage === "transcribe") return row.mediaStatus === "downloaded" && row.transcriptStatus !== "complete";
  const done = row.extractStatus === "complete" || row.extractStatus === "reviewed";
  const quarantined = row.extractStatus === "needs_human_review";
  return row.transcriptStatus === "complete" && !done && (!quarantined || Boolean(options.retryReview));
}

/** media / transcribe / extract, in CorpusAdState order (best winnerScore first). */
export function selectStageRows(stage: Exclude<AdStage, "teardown">, rows: CorpusAdStateRow[], options: QueueOptions = {}): CorpusAdStateRow[] {
  const scoped = inScope(rows, options);
  const explicit = Boolean(options.ids?.length);
  let out = explicit
    ? scoped.filter((row) => options.ids!.includes(row.id))
    : scoped.filter((row) => options.force || isReadyFor(stage, row, options));
  if (options.limit) out = out.slice(0, options.limit);
  return out;
}

export type TeardownPlan = {
  /** The winner cut, best first. */
  winners: CorpusAdStateRow[];
  /** Winners to send now: never sent, failed (retried), or completed with force. */
  todo: CorpusAdStateRow[];
  /** Winners already queued/processing on Teardown. */
  pending: CorpusAdStateRow[];
  scoredCount: number;
};

/** Teardown works on the winner cut rather than on the previous stage. `limit` is the cut size. */
export function planTeardown(rows: CorpusAdStateRow[], teardowns: AdTeardownRow[], options: QueueOptions = {}): TeardownPlan {
  const scoped = inScope(rows, options);
  const scoredCount = scoped.filter((row) => row.winnerScore != null).length;
  const winners = options.ids?.length
    ? scoped.filter((row) => options.ids!.includes(row.id))
    : pickWinners(scoped, options.limit ?? defaultWinnerCount(scoredCount));
  const byAd = new Map(teardowns.map((row) => [row.competitorAdId, row]));
  const todo = winners.filter((row) => {
    const current = byAd.get(row.id);
    if (!current || current.status === "failed") return true;
    return Boolean(options.force) && current.status === "completed";
  });
  const pending = winners.filter((row) => {
    const status = byAd.get(row.id)?.status;
    return status === "queued" || status === "processing";
  });
  return { winners, todo, pending, scoredCount };
}
