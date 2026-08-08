// Proxy-capable web scraper — an "old-fashioned" fetch + readable-text extractor
// for sources without a clean API (Quora, Mumsnet/Netmums, patient forums, TikTok
// captions, brand communities). Uses undici's ProxyAgent (already a dependency of
// Next) so requests can egress through a rotating proxy pool — no new package.
//
// Configure proxies in .env (http/https only — undici doesn't do SOCKS):
//   SCRAPER_PROXIES="http://user:pass@host:port, http://user:pass@host2:port"
//   SCRAPER_PROXY="http://user:pass@host:port"      # single alias
//
// With no proxy configured it fetches directly. Everything fails soft: a blocked
// or hung request yields null/"" so callers degrade instead of throwing.

import { ProxyAgent } from "undici";

// A realistic desktop browser UA — anti-bot edges block obvious bot UAs.
const BROWSER_UA =
  process.env.SCRAPER_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Proxy pool ──────────────────────────────────────────────────────────────
function proxyList(): string[] {
  const raw = `${process.env.SCRAPER_PROXIES ?? ""},${process.env.SCRAPER_PROXY ?? ""}`;
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

// One ProxyAgent per proxy URL, reused across requests.
const agentCache = new Map<string, ProxyAgent>();
let rotation = 0;

function agentFor(proxyUrl: string): ProxyAgent {
  let a = agentCache.get(proxyUrl);
  if (!a) {
    a = new ProxyAgent(proxyUrl);
    agentCache.set(proxyUrl, a);
  }
  return a;
}

export function proxiesConfigured(): boolean {
  return proxyList().length > 0;
}

// Round-robin the next proxy dispatcher, or undefined for a direct fetch.
export function nextProxyDispatcher(): ProxyAgent | undefined {
  const proxies = proxyList();
  if (proxies.length === 0) return undefined;
  const url = proxies[rotation % proxies.length];
  rotation = (rotation + 1) % Math.max(1, proxies.length);
  return url ? agentFor(url) : undefined;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────
export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  // How many proxies to try before giving up (also bounds direct retries).
  attempts?: number;
  accept?: string;
}

// undici's fetch honors `dispatcher` at runtime; the DOM RequestInit type doesn't
// expose it, so we attach it on a widened init and cast.
type ProxyInit = RequestInit & { dispatcher?: ProxyAgent };

export interface FetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}

/**
 * Fetch a URL as text, rotating through the proxy pool on failure. Returns null
 * only when every attempt errors (network/timeout). A non-2xx still returns a
 * result so callers can inspect the status.
 */
export async function fetchThroughProxy(url: string, opts: FetchOpts = {}): Promise<FetchResult | null> {
  const proxies = proxyList();
  const attempts = Math.max(1, opts.attempts ?? (proxies.length ? Math.min(proxies.length, 3) : 2));
  const headers = { ...DEFAULT_HEADERS, ...(opts.accept ? { Accept: opts.accept } : {}), ...opts.headers };

  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const dispatcher = nextProxyDispatcher();
    const init: ProxyInit = { headers, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? 12000) };
    if (dispatcher) init.dispatcher = dispatcher;
    try {
      const res = await fetch(url, init as RequestInit);
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        body: await res.text(),
      };
    } catch (e) {
      lastErr = e;
      // try the next proxy / retry
    }
  }
  if (lastErr) console.warn(`[scraper] all ${attempts} attempt(s) failed for ${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  return null;
}

// ─── Readable-text extraction (no dependency) ────────────────────────────────
const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " ", "&apos;": "'",
};

function decodeEntities(s: string): string {
  let out = s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp|apos);/g, (m) => ENTITIES[m] ?? m);
  // Numeric entities (decimal + hex).
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return out;
}

/** Strip an HTML document down to readable text, preserving rough paragraph breaks. */
export function extractReadableText(html: string, maxChars = 8000): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, " ");
  // Turn block-level closers into newlines so paragraphs survive the strip.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > maxChars ? s.slice(0, maxChars) + "\n…(truncated)" : s;
}

/**
 * High-level: fetch a URL (through the proxy pool) and return its readable text.
 * Returns "" on block/error/empty — safe to call and concatenate.
 */
export async function scrapeUrl(url: string, opts: FetchOpts & { maxChars?: number } = {}): Promise<string> {
  const res = await fetchThroughProxy(url, opts);
  if (!res || !res.ok || !res.body) return "";
  // If it's JSON, return it raw (caller decides); else extract readable text.
  if (res.contentType.includes("json")) return res.body.slice(0, opts.maxChars ?? 8000);
  return extractReadableText(res.body, opts.maxChars ?? 8000);
}
