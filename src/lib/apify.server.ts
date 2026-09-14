// Apify API client (server-only). Runs an actor asynchronously and polls the
// run until it finishes, because the run-sync endpoint (a) returns only items —
// no usageTotalUsd, which we need to record real spend — and (b) 408s at 300s
// while the run keeps billing. Template: src/lib/brandsearch.server.ts.
import "server-only";

const API_BASE = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 5000;

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN?.trim());
}

function apiToken(): string {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("APIFY_TOKEN is not configured on the server.");
  return token;
}

// Actor ids are env-overridable — actors get renamed/repriced on the store.
export const APIFY_ACTORS = {
  reddit: () => process.env.APIFY_ACTOR_REDDIT?.trim() || "trudax/reddit-scraper-lite",
  fbComments: () => process.env.APIFY_ACTOR_FB_COMMENTS?.trim() || "apify/facebook-comments-scraper",
  tiktokSearch: () => process.env.APIFY_ACTOR_TIKTOK_SEARCH?.trim() || "clockworks/tiktok-scraper",
  tiktokComments: () => process.env.APIFY_ACTOR_TIKTOK_COMMENTS?.trim() || "clockworks/tiktok-comments-scraper",
};

export function apifyMaxUsdPerRun(): number {
  const v = Number(process.env.APIFY_MAX_USD_PER_RUN?.trim());
  return Number.isFinite(v) && v > 0 ? v : 2;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: { type?: string; message?: string } }).error;
    if (err?.message) return `Apify: ${err.message}${err.type ? ` (${err.type})` : ""}`;
  }
  return `Apify request failed (${status}).`;
}

async function apifyJson(path: string, init?: RequestInit): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API_BASE}${path}${sep}token=${encodeURIComponent(apiToken())}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(payload, res.status));
  return payload;
}

interface ApifyRunData {
  id: string;
  status: string; // READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT
  defaultDatasetId: string;
  statusMessage?: string;
  usageTotalUsd?: number;
}

function runData(payload: unknown): ApifyRunData {
  const data = (payload as { data?: ApifyRunData } | null)?.data;
  if (!data?.id || !data.status || !data.defaultDatasetId) {
    throw new Error("Apify returned an unexpected run response.");
  }
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ApifyRunResult {
  items: unknown[];
  usd: number;
  runId: string;
}

/**
 * Start an actor run, wait for it to finish (aborting it at our own deadline so
 * billing stops), then return the dataset items plus the run's ACTUAL total USD.
 * `maxItems` is passed as a run option — on pay-per-result actors it hard-caps
 * what the run can bill.
 */
export async function runActorAndGetItems(opts: {
  actorId: string;
  input: Record<string, unknown>;
  maxItems: number;
  timeoutSecs?: number;
}): Promise<ApifyRunResult> {
  const actorPath = opts.actorId.replace("/", "~");
  const timeoutSecs = Math.max(30, opts.timeoutSecs ?? 240);
  const params = new URLSearchParams({ maxItems: String(opts.maxItems), timeout: String(timeoutSecs) });

  let run = runData(await apifyJson(`/acts/${encodeURIComponent(actorPath)}/runs?${params}`, {
    method: "POST",
    body: JSON.stringify(opts.input),
  }));

  const deadline = Date.now() + (timeoutSecs + 60) * 1000;
  while (run.status === "READY" || run.status === "RUNNING") {
    if (Date.now() > deadline) {
      // Stop the meter, then read whatever partial usage/items exist.
      try {
        run = runData(await apifyJson(`/actor-runs/${run.id}/abort`, { method: "POST" }));
      } catch { /* abort is best-effort */ }
      break;
    }
    await sleep(POLL_INTERVAL_MS);
    run = runData(await apifyJson(`/actor-runs/${run.id}`));
  }

  const usd = run.usageTotalUsd ?? 0;
  if (run.status !== "SUCCEEDED") {
    throw new Error(
      `Apify actor ${opts.actorId} ended ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : "."} (run ${run.id}, ~$${usd.toFixed(3)} spent)`,
    );
  }

  const items = await apifyJson(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${opts.maxItems}`);
  return { items: Array.isArray(items) ? items : [], usd, runId: run.id };
}
