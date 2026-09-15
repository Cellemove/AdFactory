export class RunInProgressError extends Error {
  constructor() {
    super("This ad is already being processed by another run. Let it finish before resuming.");
    this.name = "RunInProgressError";
  }
}

/**
 * A run that dies mid-flight — a serverless timeout, a deploy, an out-of-memory
 * on a large video — never reaches its own failure handler, so its row stays
 * "running" forever. Past this window another caller may take it over; no model
 * call in this pipeline comes close to it.
 */
export const RUN_STALE_AFTER_MS = 30 * 60 * 1000;

export type ClaimState = { status: string; startedAt: string };

/** The database insert and conditional retry update must each be atomic. */
export async function claimRun(store: {
  insert(): PromiseLike<{ error: { code?: string; message: string } | null }>;
  load(): Promise<ClaimState>;
  retry(previous: ClaimState): Promise<boolean>;
}, retryReview = false, now: number = Date.now()): Promise<boolean> {
  const inserted = await store.insert();
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
  const previous = await store.load();
  if (previous.status === "complete" || previous.status === "reviewed") return false;
  if (previous.status === "needs_human_review" && !retryReview) return false;
  // An unparsable startedAt reads as NaN, which is never stale — the safe answer.
  const abandoned = now - Date.parse(previous.startedAt) > RUN_STALE_AFTER_MS;
  if ((previous.status === "running" && !abandoned) || !await store.retry(previous)) throw new RunInProgressError();
  return true;
}
