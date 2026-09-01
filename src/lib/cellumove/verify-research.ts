// Anti-hallucination verification for AI research drafts.
//
// Two checks, both deterministic and fail-soft:
//   1. SOURCE LIVENESS — every cited URL is actually fetched; dead/blocked links
//      are flagged instead of trusted.
//   2. VERBATIM PROVENANCE — each quote the model labelled a "verbatim" must
//      actually appear in one of the cited pages. If we can't find it, it's
//      flagged unverified (it was likely paraphrased or invented).
//
// Nothing here throws to the caller — verification is best-effort; a blocked
// fetch yields ok:false, never an exception.

import { fetchThroughProxy, extractReadableText } from "@/lib/scraper";
import type { AvatarProfile } from "./avatar-profile";

export interface SourceCheck {
  url: string;
  ok: boolean;
  status: number;
}

export interface VerbatimCheck {
  category: string;
  text: string;
  source: string | null;
  verified: boolean;
}

export interface DraftVerification {
  checkedAt: string;
  sources: SourceCheck[];
  sourcesOk: number;
  sourcesTotal: number;
  verbatims: VerbatimCheck[];
  verbatimsVerified: number;
  verbatimsTotal: number;
}

// Minimal structural shape we verify — keeps this module decoupled from the
// full ResearchedAvatarDraft type (and avoids an import cycle with research.ts).
export interface VerifiableDraft {
  sources: string[];
  profile?: AvatarProfile | null;
}

const VERBATIM_CATEGORIES = [
  "pain",
  "desire",
  "identity",
  "actionCoping",
  "bodySensation",
  "emotionalState",
  "failedSolution",
] as const;

// Bounds so verification never blows up a research call.
const MAX_URLS = 14;
const MAX_VERBATIMS = 20;
const FETCH_TIMEOUT_MS = 8000;
const PAGE_CHARS = 60000;

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'") // curly/odd apostrophes → '
    .replace(/[“”″]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Exposed for reuse (e.g. the Spy page verifies ad captions/brands the same way).
export function normalizeForMatch(s: string): string {
  return normalize(s);
}

// A quote counts as "found" if its normalized form appears in the page, or — to
// tolerate truncation/ellipsis the model often adds — if any 8-word contiguous
// window of it appears. Quotes under 4 words are too short to verify meaningfully.
export function quoteFoundIn(quote: string, pageNorm: string): boolean {
  const q = normalize(quote);
  const words = q.split(" ").filter(Boolean);
  if (words.length < 4 || !pageNorm) return false;
  if (pageNorm.includes(q)) return true;
  const win = Math.min(8, words.length);
  for (let i = 0; i + win <= words.length; i++) {
    if (pageNorm.includes(words.slice(i, i + win).join(" "))) return true;
  }
  return false;
}

interface Fetched {
  ok: boolean;
  status: number;
  norm: string;
}

async function fetchNormalized(url: string): Promise<Fetched> {
  try {
    const res = await fetchThroughProxy(url, { timeoutMs: FETCH_TIMEOUT_MS, accept: "text/html" });
    if (!res) return { ok: false, status: 0, norm: "" };
    const text = res.contentType.includes("json")
      ? res.body.slice(0, PAGE_CHARS)
      : extractReadableText(res.body, PAGE_CHARS);
    return { ok: res.ok && Boolean(res.body), status: res.status, norm: normalize(text) };
  } catch {
    return { ok: false, status: 0, norm: "" };
  }
}

// Pull the model's claimed verbatims (anything not explicitly "reconstructed").
function collectVerbatims(profile: AvatarProfile | null | undefined): VerbatimCheck[] {
  const lm = profile?.languageMining;
  if (!lm) return [];
  const out: VerbatimCheck[] = [];
  for (const cat of VERBATIM_CATEGORIES) {
    const items = (lm as Record<string, { tier?: string; text?: string; source?: string }[] | undefined>)[cat];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!it?.text?.trim()) continue;
      if (it.tier === "reconstructed") continue; // self-declared paraphrase — not a verbatim claim
      out.push({ category: cat, text: it.text.trim(), source: it.source?.trim() || null, verified: false });
    }
  }
  return out;
}

/**
 * Verify one draft: fetch every cited URL once, confirm liveness, and check each
 * claimed verbatim against the page it cites (falling back to the whole fetched
 * corpus). Returns a structured report; never throws.
 */
export async function verifyDraft(draft: VerifiableDraft): Promise<DraftVerification> {
  const sources = (draft.sources ?? []).filter(isHttpUrl);
  const verbatims = collectVerbatims(draft.profile).slice(0, MAX_VERBATIMS);

  // Unique set of URLs to fetch: cited sources + any URL a verbatim points at.
  const urlSet = new Set<string>();
  for (const u of sources) urlSet.add(u);
  for (const v of verbatims) if (v.source && isHttpUrl(v.source)) urlSet.add(v.source);
  const urls = [...urlSet].slice(0, MAX_URLS);

  const fetched = new Map<string, Fetched>();
  await Promise.all(
    urls.map(async (u) => {
      fetched.set(u, await fetchNormalized(u));
    }),
  );

  const sourceChecks: SourceCheck[] = sources.map((u) => {
    const f = fetched.get(u);
    return { url: u, ok: f?.ok ?? false, status: f?.status ?? 0 };
  });

  // Corpus = all successfully fetched pages, for verbatims with no usable URL.
  const corpusNorm = [...fetched.values()].filter((f) => f.ok).map((f) => f.norm).join(" \n ");

  const verbatimChecks: VerbatimCheck[] = verbatims.map((v) => {
    let verified = false;
    if (v.source && isHttpUrl(v.source)) {
      const f = fetched.get(v.source);
      if (f?.ok) verified = quoteFoundIn(v.text, f.norm);
    }
    if (!verified) verified = quoteFoundIn(v.text, corpusNorm); // appears anywhere in the cited corpus
    return { ...v, verified };
  });

  return {
    checkedAt: new Date().toISOString(),
    sources: sourceChecks,
    sourcesOk: sourceChecks.filter((s) => s.ok).length,
    sourcesTotal: sourceChecks.length,
    verbatims: verbatimChecks,
    verbatimsVerified: verbatimChecks.filter((v) => v.verified).length,
    verbatimsTotal: verbatimChecks.length,
  };
}
