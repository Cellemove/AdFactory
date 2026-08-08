// Free Reddit verbatim fetcher.
//
// We pull REAL comment text (verbatims) so the research model works from actual
// words people wrote, not search snippets.
//
// Two access paths, both free:
//   1. App-only OAuth (preferred + reliable). Set REDDIT_CLIENT_ID +
//      REDDIT_CLIENT_SECRET from a free Reddit "script" app
//      (https://www.reddit.com/prefs/apps). We fetch an app-only bearer token and
//      hit api host `oauth.reddit.com` (~100 req/min). This is the path that
//      actually works — Reddit now 403-blocks anonymous `.json` from most IPs.
//   2. Anonymous `.json` fallback (no env vars). Often 403s behind Reddit's
//      anti-scraping edge; kept only as a best-effort path.
//
// Either way the module FAILS SOFT: any block/error yields an empty string and
// research continues on googleSearch + urlContext alone.
//
// Requests egress through the shared proxy pool (lib/scraper.ts) when SCRAPER_PROXIES
// is set — a residential proxy is the only way the anonymous .json path works, since
// Reddit's edge 403s datacenter IPs.

import { nextProxyDispatcher } from "@/lib/scraper";

const hasOAuth = () =>
  Boolean(process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim());

// Reddit wants a descriptive UA; OAuth UA convention: platform:appid:version (by /u/user).
const UA =
  process.env.REDDIT_USER_AGENT?.trim() ||
  "web:cellumove-ad-factory:0.1 (research verbatim collector)";

interface RedditPost {
  title: string;
  selftext: string;
  permalink: string;
  subreddit: string;
  score: number;
  num_comments: number;
}

interface RedditComment {
  body: string;
  score: number;
  author: string;
}

// ─── OAuth (app-only) ────────────────────────────────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!hasOAuth()) return null;
  // Reuse the token until ~1 min before expiry.
  if (cachedToken && cachedToken.expiresAt - 60_000 > timeNow()) return cachedToken.value;
  try {
    const auth = Buffer.from(
      `${process.env.REDDIT_CLIENT_ID!.trim()}:${process.env.REDDIT_CLIENT_SECRET!.trim()}`,
    ).toString("base64");
    // The token endpoint is on www.reddit.com (the blocked host) — proxy it too.
    const dispatcher = nextProxyDispatcher();
    const init: RequestInit & { dispatcher?: unknown } = {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    };
    if (dispatcher) init.dispatcher = dispatcher;
    const res = await fetch("https://www.reddit.com/api/v1/access_token", init as RequestInit);
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      value: json.access_token,
      expiresAt: timeNow() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

// Date.now() isolated here so the rest of the module stays easy to reason about.
function timeNow(): number {
  return Date.now();
}

// ─── Fetch ───────────────────────────────────────────────────────────────────
async function getJson(path: string): Promise<unknown | null> {
  const token = await getToken();
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  // The OAuth API host serves the same routes WITHOUT the `.json` suffix.
  const url = token ? `${base}${path}` : `${base}${withDotJson(path)}`;
  // Egress through a rotating proxy when one is configured — gives the anonymous
  // path a residential IP that Reddit's edge won't 403. Direct fetch otherwise.
  const dispatcher = nextProxyDispatcher();
  const init: RequestInit & { dispatcher?: unknown } = {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  };
  if (dispatcher) init.dispatcher = dispatcher;
  try {
    const res = await fetch(url, init as RequestInit);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return null; // anti-bot HTML page → treat as blocked
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// Insert `.json` before any querystring for the anonymous path.
function withDotJson(path: string): string {
  const [p, q] = path.split("?");
  return q ? `${p}.json?${q}` : `${p}.json`;
}

/** Search Reddit for a query — site-wide, or within one subreddit when given. */
async function searchReddit(
  query: string,
  limit = 6,
  subreddit?: string,
  time: "hour" | "day" | "week" | "month" | "year" | "all" = "year",
): Promise<RedditPost[]> {
  const qs = `q=${encodeURIComponent(query)}&sort=relevance&t=${time}&limit=${limit}&type=link&raw_json=1`;
  const path = subreddit
    ? `/r/${encodeURIComponent(subreddit)}/search?${qs}&restrict_sr=1`
    : `/search?${qs}`;
  return getChildrenData<RedditPost>(await getJson(path)).filter(
    (p) => p && typeof p.permalink === "string",
  );
}

/** Pull the top comment bodies from a single thread via its permalink. */
async function fetchThreadComments(permalink: string, take = 8): Promise<RedditComment[]> {
  const path = `${permalink}?limit=${take}&depth=1&sort=top&raw_json=1`;
  const json = await getJson(path);
  // A thread response is a 2-element array: [post listing, comments listing].
  if (!Array.isArray(json) || json.length < 2) return [];
  return getChildrenData<RedditComment>(json[1])
    .filter(
      (c) =>
        c && typeof c.body === "string" && c.body !== "[deleted]" && c.body !== "[removed]",
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, take);
}

// Both search results and comment listings share the Listing -> data.children[].data shape.
function getChildrenData<T>(json: unknown): T[] {
  const listing = json as { data?: { children?: Array<{ data?: T }> } } | undefined;
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  return children.map((c) => c?.data).filter(Boolean) as T[];
}

/**
 * Run a few Reddit searches and return a formatted block of real thread titles +
 * top comments, ready to paste into a research prompt. Bounded in size so it can't
 * blow up token cost. Returns "" if nothing usable came back (no creds + anon
 * blocked, or no results).
 */
export async function gatherRedditVerbatims(
  queries: string[],
  opts: { maxThreads?: number; maxChars?: number; subreddits?: string[] } = {},
): Promise<string> {
  const maxThreads = opts.maxThreads ?? 6;
  const maxChars = opts.maxChars ?? 7000;

  // Search across all queries, dedupe threads by permalink, keep the highest-scored.
  const seen = new Map<string, RedditPost>();
  const keep = (post: RedditPost) => {
    const existing = seen.get(post.permalink);
    if (!existing || (post.score ?? 0) > (existing.score ?? 0)) seen.set(post.permalink, post);
  };
  for (const q of queries.slice(0, 4)) {
    for (const post of await searchReddit(q, 5)) keep(post);
  }
  // Also search WITHIN the angle's communities — higher signal than site-wide.
  const subs = (opts.subreddits ?? []).slice(0, 8);
  const primary = queries[0];
  if (primary) {
    for (const sub of subs) {
      for (const post of await searchReddit(primary, 4, sub)) keep(post);
    }
  }
  const posts = [...seen.values()]
    .sort((a, b) => (b.num_comments ?? 0) - (a.num_comments ?? 0))
    .slice(0, maxThreads);
  if (posts.length === 0) return "";

  const blocks: string[] = [];
  for (const post of posts) {
    const comments = await fetchThreadComments(post.permalink);
    if (comments.length === 0 && !post.selftext) continue;
    const lines = [
      `### r/${post.subreddit} — "${post.title}" (${post.num_comments} comments)`,
      `https://www.reddit.com${post.permalink}`,
    ];
    if (post.selftext?.trim()) lines.push(`OP: ${truncate(post.selftext.trim(), 600)}`);
    for (const c of comments) {
      const body = truncate(c.body.trim().replace(/\s+/g, " "), 500);
      if (body) lines.push(`- (${c.score}↑) ${body}`);
    }
    blocks.push(lines.join("\n"));
  }

  let out = blocks.join("\n\n");
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n…(truncated)";
  return out.trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ─── Permalink resolution (fixes hallucinated post IDs) ──────────────────────
// The model reconstructs Reddit URLs from the title and fabricates the opaque
// post id. Instead of trusting that, we SEARCH Reddit for the exact title within
// the subreddit and take the real permalink from Reddit's own results — the id is
// then correct by construction. Works through the same OAuth/anon+proxy path as
// the verbatim fetcher (no extra creds). Returns null when nothing matches well.

export interface ResolvedPermalink {
  url: string;     // canonical https://www.reddit.com/r/.../comments/<real id>/...
  title: string;   // the real post title from Reddit
}

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Word-set Jaccard — tolerant of minor differences (ellipsis, apostrophes,
// reordering) while still rejecting a wholly different post with a shared word.
function titleSimilarity(a: string, b: string): number {
  const sa = new Set(normTitle(a).split(" ").filter(Boolean));
  const sb = new Set(normTitle(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function cleanSub(subreddit: string | null | undefined): string | undefined {
  const s = (subreddit ?? "").replace(/^\/?r\//i, "").trim();
  return s || undefined;
}

/**
 * Resolve the REAL permalink for a post, given its (model-written) title and
 * subreddit. Searches the exact title in-subreddit first, then site-wide, and
 * returns the best title match. null when no result clears the similarity bar
 * (so the caller can flag the link rather than ship a fabricated id).
 */
export async function resolveRedditPermalink(
  subreddit: string | null | undefined,
  title: string,
): Promise<ResolvedPermalink | null> {
  const t = (title ?? "").trim();
  if (t.length < 8) return null; // too short to match reliably
  const sub = cleanSub(subreddit);

  let posts = await searchReddit(t, 8, sub, "all");
  if (posts.length === 0 && sub) posts = await searchReddit(t, 8, undefined, "all"); // site-wide fallback
  if (posts.length === 0) return null;

  let best: RedditPost | null = null;
  let bestScore = 0;
  for (const p of posts) {
    const score = titleSimilarity(t, p.title ?? "");
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best || bestScore < 0.6) return null; // weak match — don't trust it
  return { url: `https://www.reddit.com${best.permalink}`, title: best.title };
}
