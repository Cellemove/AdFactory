"use server";

import { revalidatePath } from "next/cache";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { gatherRedditVerbatims, resolveRedditPermalink } from "@/lib/reddit";
import { gatherYouTubeComments, fetchYouTubeThreads, formatYouTubeThreads, type YTThread } from "@/lib/youtube";
import { subredditsForAngle, renderSubredditBlock } from "@/lib/cellumove/subreddits";
import { runAgent, extractJsonObject } from "@/lib/cellumove/agents";
import {
  loadAvatarContext,
  researchBlock,
  renderProfileFor,
  deepDiveBlock,
  type AvatarCtx,
} from "@/lib/cellumove/context";
import {
  stageDef,
  BRAND_BASE,
  BRAND_PRODUCT_TERMS,
  DEEP_DIVE_PASS_INSTRUCTION,
  DEEP_DIVE_SYNTHESIS_INSTRUCTION,
  deepDiveDepthConfig,
  type PipelineStageKey,
  type DeepDiveDepth,
} from "@/lib/cellumove/pipeline-stages";
import { scanClaims, type ClaimScan } from "@/lib/cellumove/claim-check";
import { exclusionBlock, isNearDuplicate } from "@/lib/cellumove/novelty";
import { brollLibraryContext, recordBrollSuggestions } from "@/app/actions/broll";
import { fetchThroughProxy } from "@/lib/scraper";
import type { ResearchRow } from "@/lib/database.types";

// Per-stage verification: a compliance/claim scan of the generated copy + a
// liveness check of any URLs it cited. The "new system" applied to the pipeline.
export interface SourceCheck {
  url: string;
  ok: boolean;
  status: number;
}
export interface StageVerification {
  claims: ClaimScan;
  sources: SourceCheck[];
  sourcesOk: number;
  sourcesTotal: number;
}

// A pipeline run is persisted as one Research row (type "pipeline") — same
// zero-migration trick the Spy page uses. `drafts` holds the doc below as JSON.
export interface PipelineDoc {
  subAvatarId: string;
  angleSlug: string;
  stages: Partial<Record<PipelineStageKey, unknown>>; // each stage's parsed JSON output
  verification?: Partial<Record<PipelineStageKey, StageVerification>>;
}

export interface PipelineRun {
  id: string;
  createdAt: string;
  doc: PipelineDoc;
}

function parseDoc(raw: string): PipelineDoc {
  try {
    const d = JSON.parse(raw) as Partial<PipelineDoc>;
    return {
      subAvatarId: d.subAvatarId ?? "",
      angleSlug: d.angleSlug ?? "",
      stages: d.stages && typeof d.stages === "object" ? d.stages : {},
      verification: d.verification && typeof d.verification === "object" ? d.verification : {},
    };
  } catch {
    return { subAvatarId: "", angleSlug: "", stages: {}, verification: {} };
  }
}

// Re-read the run's doc right before writing, so a sibling stage that finished
// during our long model call isn't clobbered — callers patch only their own key
// onto the freshest doc. Narrows the lost-update window to the merge itself.
async function reloadDoc(runId: string, fallback: PipelineDoc): Promise<PipelineDoc> {
  const res = await supabase
    .from("Research")
    .select("drafts")
    .eq("id", runId)
    .eq("type", "pipeline")
    .maybeSingle();
  if (res.error || !res.data) return fallback;
  return parseDoc((res.data as { drafts: string }).drafts);
}

// Collect every string in a stage's JSON output into one blob for scanning.
function collectText(value: unknown, acc: string[]): void {
  if (value == null) return;
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectText(v, acc);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectText(v, acc);
  }
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

// Apply the verification system to a generated stage: scan its copy for
// compliance claims and confirm any cited URLs actually load. Fail-soft.
async function verifyStageOutput(output: unknown): Promise<StageVerification> {
  const parts: string[] = [];
  collectText(output, parts);
  const text = parts.join("\n");

  const claims = scanClaims(text);

  const urls = [...new Set(text.match(URL_RE) ?? [])].slice(0, 6);
  const sources = await Promise.all(
    urls.map(async (url): Promise<SourceCheck> => {
      try {
        const r = await fetchThroughProxy(url, { timeoutMs: 8000, accept: "text/html" });
        return { url, ok: Boolean(r && r.ok && r.body), status: r?.status ?? 0 };
      } catch {
        return { url, ok: false, status: 0 };
      }
    }),
  );

  return { claims, sources, sourcesOk: sources.filter((s) => s.ok).length, sourcesTotal: sources.length };
}

// Context builders (loadAvatarContext, researchBlock, renderProfileFor,
// deepDiveBlock) live in lib/cellumove/context.ts — shared with the copywriter.

// Render the prior stages a stage depends on, as labelled JSON blocks. The
// grounded deep dive (G2) is rendered separately (deepDiveBlock), so skip it here.
function priorStagesBlock(doc: PipelineDoc, needs: PipelineStageKey[]): string {
  const blocks = needs
    .filter((k) => k !== "deepDive")
    .map((k) => {
      const out = doc.stages[k];
      if (out == null) return "";
      const def = stageDef(k);
      return `### ${def.code} — ${def.title} (output)\n${JSON.stringify(out, null, 2)}`;
    })
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return ["UPSTREAM STAGE OUTPUTS — build directly on these:", "", blocks.join("\n\n")].join("\n");
}

// ─── Progressive deep-dive accumulator (G2) ───────────────────────────────────
interface DeepDiveVerbatim {
  text: string;
  source?: string;
  speaker?: string;
  category?: string;
  theme?: string;
}
interface DeepDiveThreadComment {
  text: string;
  likes?: number;
  speaker?: string;
  category?: string;
}
interface DeepDiveSourceThread {
  url: string;
  title?: string;
  platform?: string;
  comments?: DeepDiveThreadComment[]; // the relevant comments/quotes pulled from it
}
interface DeepDiveEmotionalDirection {
  direction?: string;
  approach?: string;
}
// The final angle-synthesis brief (generated once when the deep dive completes).
interface DeepDiveSynthesis {
  whoThisAngleSpeaksTo?: string;
  biggestPain?: string;
  emotionalPain?: string;
  desiredOutcome?: string;
  biggestMisconception?: string;
  existingBeliefs?: string[];
  objections?: string[];
  triggerMoments?: string[];
  hiddenEmotionalTruth?: string;
  freshInsights?: string[];
  competitorBlindSpots?: string[];
  whyOutperformsGeneric?: string;
  positioningVariations?: string[];
  emotionalDirections?: DeepDiveEmotionalDirection[];
  messagingTerritories?: string[];
  singleStrongestInsight?: string;
}
interface DeepDiveAccumulator {
  kind: "progressive";
  depth: DeepDiveDepth;
  target: number; // distinct-thread target
  avatar?: string;
  threads: DeepDiveSourceThread[]; // distinct threads read — the tier metric
  verbatims: DeepDiveVerbatim[];
  synthesis?: DeepDiveSynthesis; // decision-ready angle brief, set on completion
  bigPatterns: string[];
  painPoints: string[];
  desires: string[];
  fears: string[];
  objections: string[];
  dailyLanguage: string[];
  outliers: string[];
  subredditsExplored: string[];
  passes: number;
  dryStreak: number;
  done: boolean;
  updatedAt: string;
}

export interface DeepDiveProgress {
  collected: number;
  target: number;
  passes: number;
  added: number;
  done: boolean;
  depth: DeepDiveDepth;
  output: unknown; // the accumulator, for the UI to render/preview/download
  verification?: StageVerification; // only computed on the final pass
}

function emptyAccumulator(depth: DeepDiveDepth, target: number): DeepDiveAccumulator {
  return {
    kind: "progressive",
    depth,
    target,
    threads: [],
    verbatims: [],
    bigPatterns: [],
    painPoints: [],
    desires: [],
    fears: [],
    objections: [],
    dailyLanguage: [],
    outliers: [],
    subredditsExplored: [],
    passes: 0,
    dryStreak: 0,
    done: false,
    updatedAt: new Date().toISOString(),
  };
}

// Reuse a prior accumulator if one exists (so passes keep accumulating), otherwise
// start fresh. Depth/target always reflect the CURRENT selection.
function asAccumulator(v: unknown, depth: DeepDiveDepth, target: number): DeepDiveAccumulator {
  const base = emptyAccumulator(depth, target);
  if (v && typeof v === "object" && (v as { kind?: unknown }).kind === "progressive") {
    const a = v as DeepDiveAccumulator;
    // If the user bumped to a bigger tier, clear the dry-streak so mining resumes
    // instead of instantly re-stopping on the inherited streak.
    const targetChanged = typeof a.target === "number" && a.target !== target;
    return {
      ...base,
      ...a,
      depth,
      target,
      // never trust these to be arrays after a schema change
      threads: Array.isArray(a.threads) ? a.threads : [],
      verbatims: Array.isArray(a.verbatims) ? a.verbatims : [],
      bigPatterns: Array.isArray(a.bigPatterns) ? a.bigPatterns : [],
      painPoints: Array.isArray(a.painPoints) ? a.painPoints : [],
      desires: Array.isArray(a.desires) ? a.desires : [],
      fears: Array.isArray(a.fears) ? a.fears : [],
      objections: Array.isArray(a.objections) ? a.objections : [],
      dailyLanguage: Array.isArray(a.dailyLanguage) ? a.dailyLanguage : [],
      outliers: Array.isArray(a.outliers) ? a.outliers : [],
      subredditsExplored: Array.isArray(a.subredditsExplored) ? a.subredditsExplored : [],
      passes: typeof a.passes === "number" ? a.passes : 0,
      dryStreak: targetChanged ? 0 : typeof a.dryStreak === "number" ? a.dryStreak : 0,
      done: false, // always recomputed at the end of a pass; never inherit a stale value
      // Regenerate the synthesis for the new (bigger) corpus when the tier changes.
      synthesis: targetChanged ? undefined : a.synthesis,
    };
  }
  // Legacy single-shot deep dive (pre-progressive shape): convert it into a
  // completed accumulator so it reads as done and is never silently discarded.
  if (v && typeof v === "object") {
    return legacyToAccumulator(v as Record<string, unknown>, base);
  }
  return base;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim())
    : [];
}

// Normalize a URL to the THREAD level for dedup. Platform-aware so we don't
// over-collapse (all YouTube watch URLs) or over-count (Reddit comment permalinks
// of the same post counted as separate threads).
function normalizeUrl(u: string): string {
  let s = u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  // YouTube: dedup on the video id (in ?v= or youtu.be/<id>).
  const yt = s.match(/[?&]v=([a-z0-9_-]{6,})/i) ?? s.match(/^youtu\.be\/([a-z0-9_-]{6,})/i);
  if (yt?.[1]) return `youtube.com/watch?v=${yt[1]}`;
  s = s.replace(/[?#].*$/, "");
  // Reddit: collapse a comment permalink down to its post (thread) id.
  const rd = s.match(/^reddit\.com\/r\/[^/]+\/comments\/[^/]+/);
  if (rd?.[0]) return rd[0];
  return s.replace(/\/+$/, "");
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>)\]]+/g;

// Pull thread/video URLs out of a scraped verbatim blob (one per Reddit/YouTube block).
function extractUrls(blob: string): string[] {
  return blob ? [...new Set(blob.match(URL_IN_TEXT_RE) ?? [])] : [];
}

// Add comments to a thread, deduped by text, capped so storage stays bounded.
function addComments(thread: DeepDiveSourceThread, comments: DeepDiveThreadComment[], cap = 15): void {
  if (!thread.comments) thread.comments = [];
  const seen = new Set(thread.comments.map((c) => c.text.toLowerCase().trim()));
  for (const c of comments) {
    const key = c.text?.toLowerCase().trim() ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (thread.comments.length < cap) thread.comments.push(c);
  }
}

// Attach the relevant comments to each thread for the deliverable view: the REAL
// YouTube comments we fetched + the model-mined verbatims, grouped by their thread.
function attachCommentsToThreads(
  acc: DeepDiveAccumulator,
  ytThreads: YTThread[],
  verbatims: DeepDiveVerbatim[],
): void {
  const byUrl = new Map<string, DeepDiveSourceThread>();
  for (const t of acc.threads) byUrl.set(normalizeUrl(t.url), t);

  for (const yt of ytThreads) {
    const th = byUrl.get(normalizeUrl(yt.url));
    if (!th) continue;
    if (!th.title) th.title = yt.title;
    if (!th.platform) th.platform = "youtube";
    addComments(th, yt.comments.map((c) => ({ text: c.text, likes: c.likes })));
  }
  for (const vb of verbatims) {
    if (!vb.source) continue;
    const th = byUrl.get(normalizeUrl(vb.source));
    if (!th) continue;
    addComments(th, [{ text: vb.text, speaker: vb.speaker, category: vb.category }]);
  }
}

// Merge candidate threads into the accumulator, deduped by normalized URL. Returns
// how many NEW distinct threads were added.
function mergeThreads(acc: DeepDiveAccumulator, candidates: DeepDiveSourceThread[]): number {
  const seen = new Set(acc.threads.map((t) => normalizeUrl(t.url)));
  let added = 0;
  for (const c of candidates) {
    const url = (c.url ?? "").trim();
    if (!url) continue;
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    acc.threads.push({
      url,
      title: typeof c.title === "string" ? c.title : undefined,
      platform: typeof c.platform === "string" ? c.platform : undefined,
    });
    added++;
  }
  return added;
}

// Map the old single-shot deep-dive shape ({avatar, themes:[{topQuotes, threads:
// [{exchange}]}], painPoints, ...}) into the accumulator, marked done. Preserves
// the research so a re-run EXTENDS it rather than wiping it.
function legacyToAccumulator(v: Record<string, unknown>, base: DeepDiveAccumulator): DeepDiveAccumulator {
  const verbatims: DeepDiveVerbatim[] = [];
  const threadCandidates: DeepDiveSourceThread[] = [];
  const themes = Array.isArray(v.themes) ? v.themes : [];
  for (const th of themes) {
    const t = th as { theme?: unknown; threads?: unknown; topQuotes?: unknown };
    const theme = typeof t.theme === "string" ? t.theme : undefined;
    for (const q of Array.isArray(t.topQuotes) ? t.topQuotes : []) {
      const qq = q as { text?: unknown; source?: unknown };
      if (typeof qq.text === "string" && qq.text.trim()) {
        verbatims.push({ text: qq.text.trim(), source: typeof qq.source === "string" ? qq.source : undefined, theme });
      }
    }
    for (const thread of Array.isArray(t.threads) ? t.threads : []) {
      const tr = thread as { url?: unknown; postTitle?: unknown; subreddit?: unknown; exchange?: unknown };
      const url = typeof tr.url === "string" ? tr.url : undefined;
      if (url) {
        threadCandidates.push({
          url,
          title: typeof tr.postTitle === "string" ? tr.postTitle : undefined,
          platform: typeof tr.subreddit === "string" ? "reddit" : undefined,
        });
      }
      for (const ex of Array.isArray(tr.exchange) ? tr.exchange : []) {
        const e = ex as { speaker?: unknown; quote?: unknown };
        if (typeof e.quote === "string" && e.quote.trim()) {
          verbatims.push({
            text: e.quote.trim(),
            source: url,
            speaker: typeof e.speaker === "string" ? e.speaker : undefined,
            theme,
          });
        }
      }
    }
  }
  const acc: DeepDiveAccumulator = {
    ...base,
    avatar: typeof v.avatar === "string" ? v.avatar : undefined,
    verbatims,
    bigPatterns: strArr(v.bigPatterns),
    painPoints: strArr(v.painPoints),
    desires: strArr(v.desires),
    fears: strArr(v.fears),
    objections: strArr(v.objections),
    dailyLanguage: strArr(v.dailyLanguage),
    outliers: strArr(v.outliers),
    subredditsExplored: strArr(v.subredditsExplored),
    passes: 1,
    dryStreak: 0,
    done: true,
    updatedAt: new Date().toISOString(),
  };
  // Seed threads from the legacy thread URLs + any distinct verbatim sources, then
  // group the legacy quotes under their threads as comments.
  mergeThreads(acc, [
    ...threadCandidates,
    ...verbatims.filter((vb) => vb.source).map((vb) => ({ url: vb.source as string })),
  ]);
  attachCommentsToThreads(acc, [], verbatims);
  return acc;
}

interface DeepDivePassResult {
  avatar?: string;
  threadsRead?: Array<Partial<DeepDiveSourceThread>>;
  verbatims?: Array<Partial<DeepDiveVerbatim>>;
  bigPatterns?: unknown;
  painPoints?: unknown;
  desires?: unknown;
  fears?: unknown;
  objections?: unknown;
  dailyLanguage?: unknown;
  outliers?: unknown;
  subredditsExplored?: unknown;
}

// Union new strings into an existing list, case-insensitively deduped.
function unionStrings(existing: string[], incoming: unknown): string[] {
  const seen = new Set(existing.map((s) => s.toLowerCase().trim()));
  const out = [...existing];
  if (Array.isArray(incoming)) {
    for (const x of incoming) {
      if (typeof x !== "string") continue;
      const t = x.trim();
      const key = t.toLowerCase();
      if (t && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

// Rotate an array so each pass starts from a different offset (diversifies which
// subreddits / queries a pass leans on, so passes surface new material).
function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const n = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(n), ...arr.slice(0, n)];
}

// YouTube queries grounded in BOTH the brand's product category and the avatar's
// problem — so comments come from real compression/shaping-legging videos relevant
// to her, not the persona's abstract name (which returns nothing useful on YouTube).
function youtubeQueriesFor(ctx: AvatarCtx, passIndex = 0): string[] {
  const problem = ctx.angle.name;
  const first = BRAND_PRODUCT_TERMS[0] ?? "compression leggings";
  const all = [
    ...BRAND_PRODUCT_TERMS.map((t) => `${t} ${problem}`.trim()), // brand × avatar problem
    `compression leggings for ${problem}`.trim(),
    `${problem} leggings before and after`.trim(),
    `${first} review`,
    ...BRAND_PRODUCT_TERMS.slice(1).map((t) => `${t} review`),
  ].filter((q) => q && q.trim());
  return rotate([...new Set(all)], passIndex);
}

// One-time final synthesis over the whole accumulated corpus → a decision-ready
// angle brief. Closed-book (no tools) so JSON mode is allowed. Fail-soft → null.
async function synthesizeDeepDive(
  ctx: AvatarCtx,
  acc: DeepDiveAccumulator,
  runId: string,
): Promise<DeepDiveSynthesis | null> {
  try {
    const llm = getLLM();
    const list = (label: string, items: string[]) =>
      items.length ? `${label}:\n${items.map((x) => `- ${x}`).join("\n")}` : "";
    const sampleVerbatims = acc.verbatims
      .slice(0, 80)
      .map((v) => `- "${v.text}"${v.category ? ` [${v.category}]` : ""}`)
      .join("\n");
    const threadTitles = acc.threads
      .slice(0, 40)
      .map((t) => `- ${t.title || t.url} [${t.platform ?? "web"}]`)
      .join("\n");
    const corpus = [
      BRAND_BASE,
      `ANGLE: ${ctx.angle.name} (${ctx.angle.slug}) — mechanism: ${ctx.angle.mechanism}`,
      `AVATAR: ${ctx.sub.name}${ctx.sub.shortDesc ? ` — ${ctx.sub.shortDesc}` : ""}`,
      acc.avatar ? `AVATAR SUMMARY: ${acc.avatar}` : "",
      list("BIG PATTERNS", acc.bigPatterns),
      list("PAIN POINTS", acc.painPoints),
      list("DESIRES", acc.desires),
      list("FEARS", acc.fears),
      list("OBJECTIONS", acc.objections),
      list("DAILY LANGUAGE", acc.dailyLanguage),
      list("OUTLIERS", acc.outliers),
      `REAL VERBATIMS (sample of ${acc.verbatims.length} across ${acc.threads.length} threads):\n${sampleVerbatims}`,
      threadTitles ? `THREADS READ (sample):\n${threadTitles}` : "",
      "",
      "Produce the angle synthesis now. Return ONLY the JSON object described in the system prompt.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const resp = await llm.models.generateContent({
      model: DEFAULT_MODEL,
      contents: corpus,
      config: {
        systemInstruction: DEEP_DIVE_SYNTHESIS_INSTRUCTION,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 4096 },
      },
    });
    await recordUsage({
      feature: "pipeline_g2_synthesis",
      model: DEFAULT_MODEL,
      usage: resp.usageMetadata,
      grounded: false,
      metadata: { runId, stage: "deepDive", subAvatarId: ctx.sub.id },
    });
    const text = resp.text ?? "";
    if (!text.trim()) return null;
    return extractJsonObject<DeepDiveSynthesis>(text);
  } catch {
    return null;
  }
}

const PASS_QUERY_MODIFIERS = [
  "what helps",
  "tried everything",
  "anyone else",
  "my experience",
  "finally",
  "i'm so tired of",
  "before and after",
  "is it normal",
  "does anyone",
  "what worked for me",
];

// Cross-run novelty: what we've ALREADY built for this same avatar in prior runs,
// so a re-run finds new angles/mechanisms/hooks instead of restating the last one.
async function priorRunsNoveltyBlock(avatarName: string, currentRunId: string): Promise<string> {
  if (!avatarName) return "";
  try {
    const res = await supabase
      .from("Research")
      .select("id, drafts")
      .eq("type", "pipeline")
      .eq("focus", avatarName)
      .order("createdAt", { ascending: false })
      .limit(6);
    if (res.error) return "";
    const items: string[] = [];
    for (const row of (res.data ?? []) as { id: string; drafts: string }[]) {
      if (row.id === currentRunId) continue;
      let stages: Record<string, unknown> = {};
      try {
        stages = (JSON.parse(row.drafts) as { stages?: Record<string, unknown> }).stages ?? {};
      } catch {
        continue;
      }
      const push = (v: unknown, prefix = "") => {
        if (Array.isArray(v)) {
          for (const x of v) if (typeof x === "string" && x.trim()) items.push(prefix + x);
        } else if (typeof v === "string" && v.trim()) {
          items.push(prefix + v);
        }
      };
      const dd = stages.deepDive as { bigPatterns?: unknown } | undefined;
      push(dd?.bigPatterns);
      const rc = stages.rootCause as { mechanism?: { name?: unknown }; villains?: Array<{ name?: unknown }> } | undefined;
      push(rc?.mechanism?.name, "Mechanism: ");
      if (Array.isArray(rc?.villains)) push(rc!.villains.map((v) => v?.name).filter((n) => typeof n === "string"), "Villain: ");
      const ca = stages.copyArsenal as { bigIdeas?: unknown; hooks?: unknown } | undefined;
      push(ca?.bigIdeas);
      push(ca?.hooks);
    }
    return exclusionBlock(
      "ALREADY BUILT FOR THIS AVATAR IN PRIOR RUNS — GO FURTHER",
      "You've already produced these patterns, mechanisms, and hooks for this same avatar. Find NEW angles, a fresh mechanism framing, and different hooks — do not restate these:",
      items,
    );
  } catch {
    return "";
  }
}

// Wrap fetched raw verbatims for the prompt; "" when empty so it appends safely.
function verbatimBlock(label: string, verbatims: string): string {
  if (!verbatims.trim()) return "";
  return ["", `${label} — already fetched in full for you (quote these directly, with their URLs):`, verbatims].join("\n");
}

// Grounded stage runner (e.g. G2 deep dive): googleSearch + urlContext + injected
// real Reddit verbatims. No responseMimeType (Vertex disallows it with tools), so
// JSON is parsed from text.
async function runGroundedStage(
  def: ReturnType<typeof stageDef>,
  ctx: AvatarCtx,
  runId: string,
  novelty: string,
): Promise<unknown> {
  const llm = getLLM();
  const subs = subredditsForAngle({
    slug: ctx.angle.slug,
    name: ctx.angle.name,
    mechanism: ctx.angle.mechanism,
    requiredKeyword: ctx.angle.requiredKeyword,
    focus: ctx.sub.name,
  });
  const queries = [
    ctx.sub.name,
    `${ctx.angle.name} ${ctx.angle.requiredKeyword}`,
    `${ctx.angle.name} what helps`,
    `${ctx.angle.requiredKeyword} tried everything`,
  ].filter(Boolean);
  // Fetch raw verbatims from multiple sources in parallel — Reddit + YouTube
  // comments. Both fail soft to "" so a missing key/block just skips that source.
  const [reddit, youtube] = await Promise.all([
    gatherRedditVerbatims(queries, { subreddits: subs }),
    gatherYouTubeComments(youtubeQueriesFor(ctx)),
  ]);
  const userPrompt = [
    BRAND_BASE,
    researchBlock(ctx),
    `AVATAR TO DEEP-DIVE: ${ctx.sub.name}${ctx.sub.shortDesc ? ` — ${ctx.sub.shortDesc}` : ""}`,
    "",
    "Search the web NOW and do the deep research described in the system prompt. Mine the raw verbatims already fetched below (Reddit + YouTube comments), and open the most promising threads/pages IN FULL with url-context before drafting. Return ONLY the JSON object described there.",
    novelty,
    renderSubredditBlock(subs),
    verbatimBlock("REAL REDDIT VERBATIMS", reddit),
    verbatimBlock("REAL YOUTUBE COMMENTS", youtube),
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: def.instruction,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: def.maxOutputTokens ?? 32768,
      thinkingConfig: { thinkingBudget: def.thinkingBudget ?? 4096 },
    },
  });
  await recordUsage({
    feature: def.feature,
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { runId, stage: def.key, subAvatarId: ctx.sub.id },
  });
  const text = resp.text ?? "";
  if (!text.trim()) throw new Error(`${def.title} returned no content.`);
  return extractJsonObject<unknown>(text);
}

interface DeepDiveThread {
  subreddit?: string;
  postTitle?: string;
  url?: string;
  linkVerified?: boolean;
}

// Stop shipping fabricated Reddit post ids: re-resolve each thread's permalink
// from Reddit's own search (real id by construction). Unresolved threads get a
// guaranteed-working in-sub search URL + linkVerified:false instead of a fake
// permalink. Bounded + fail-soft.
async function resolveDeepDiveLinks(output: unknown): Promise<unknown> {
  if (!output || typeof output !== "object") return output;
  const themes = (output as { themes?: Array<{ threads?: DeepDiveThread[] }> }).themes;
  if (!Array.isArray(themes)) return output;

  const threads: DeepDiveThread[] = [];
  for (const th of themes) if (Array.isArray(th?.threads)) threads.push(...th.threads);

  await Promise.all(
    threads.slice(0, 30).map(async (t) => {
      if (!t?.postTitle) return;
      // Only re-resolve REDDIT threads — leave YouTube/Quora/forum links untouched.
      const url = t.url ?? "";
      const sub = (t.subreddit ?? "").toLowerCase().replace(/^\/?r\//, "");
      const isOther = /youtube\.com|youtu\.be|tiktok\.com|quora\.com|trustpilot/i.test(url) ||
        ["youtube", "tiktok", "quora", "trustpilot"].includes(sub);
      const looksReddit = /reddit\.com/i.test(url) || (!isOther && sub !== "");
      if (!looksReddit) return;
      try {
        const resolved = await resolveRedditPermalink(t.subreddit, t.postTitle);
        if (resolved) {
          t.url = resolved.url;
          t.linkVerified = true;
        } else {
          const sub = (t.subreddit ?? "").replace(/^\/?r\//i, "").trim();
          // Fall back to a search URL that always works — never a fabricated id.
          t.url = sub
            ? `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(t.postTitle)}&restrict_sr=1`
            : t.url ?? "";
          t.linkVerified = false;
        }
      } catch {
        t.linkVerified = false;
      }
    }),
  );
  return output;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createPipelineRun(subAvatarId: string): Promise<{ runId: string }> {
  if (!subAvatarId) throw new Error("Pick a sub-avatar to start a pipeline.");
  const ctx = await loadAvatarContext(subAvatarId); // validates G1/G2 readiness

  const id = newId();
  const doc: PipelineDoc = { subAvatarId, angleSlug: ctx.angle.slug, stages: {} };
  const res = await supabase.from("Research").insert({
    id,
    type: "pipeline",
    angleSlug: ctx.angle.slug,
    focus: ctx.sub.name,
    drafts: JSON.stringify(doc),
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/pipeline");
  return { runId: id };
}

export async function runPipelineStage(
  runId: string,
  stageKey: PipelineStageKey,
): Promise<{ output: unknown; verification: StageVerification }> {
  const def = stageDef(stageKey);

  const row = unwrapOpt(
    await supabase.from("Research").select("*").eq("id", runId).eq("type", "pipeline").maybeSingle(),
  ) as ResearchRow | null;
  if (!row) throw new Error("Pipeline run not found.");
  const doc = parseDoc(row.drafts);

  // Gate: every upstream stage this one depends on must be done first. For the
  // progressive deep dive, "done" means the accumulator finished — not just that a
  // partial pass persisted something (legacy single-shot deep dives count as done).
  const blocked = def.needs.filter((k) => {
    const v = doc.stages[k];
    if (v == null) return true;
    if (k === "deepDive") {
      const a = v as { kind?: unknown; done?: unknown };
      return a.kind === "progressive" && a.done !== true;
    }
    return false;
  });
  if (blocked.length) {
    const labels = blocked.map((k) => `${stageDef(k).code} ${stageDef(k).title}`).join(", ");
    throw new Error(`Run the earlier stage(s) first: ${labels}.`);
  }

  const ctx = await loadAvatarContext(doc.subAvatarId);
  // What we've already built for this avatar in prior runs — fed in so re-runs diverge.
  const novelty = await priorRunsNoveltyBlock(ctx.sub.name, runId);

  let output: unknown;
  if (def.grounded) {
    // G2 deep dive: live web/Reddit research grounded in googleSearch + url-context.
    output = await runGroundedStage(def, ctx, runId, novelty);
    // Re-resolve cited Reddit permalinks so we never ship a hallucinated post id.
    if (stageKey === "deepDive") output = await resolveDeepDiveLinks(output);
  } else {
    // Creative Briefs (G7) gets the real b-roll library so its shot lists map to
    // clips we actually have; other stages don't need it.
    const broll = def.key === "creativeBriefs" ? await brollLibraryContext() : "";
    const context = [
      BRAND_BASE,
      researchBlock(ctx),
      renderProfileFor(def.role, ctx),
      // The grounded G2 research feeds every downstream stage. AIR is a pure
      // synthesis OF that corpus, so it gets a much larger verbatim sample.
      deepDiveBlock(doc.stages.deepDive, def.key === "avatarIntel" ? 400 : 80),
      novelty,
      priorStagesBlock(doc, def.needs),
      broll,
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await runAgent({
      role: def.role,
      instruction: def.instruction,
      context,
      json: true,
      feature: def.feature,
      metadata: { runId, stage: stageKey, subAvatarId: doc.subAvatarId },
      maxOutputTokens: def.maxOutputTokens,
      thinkingBudget: def.thinkingBudget,
    });
    output = extractJsonObject<unknown>(text);

    // B-roll detection: count which real clips the briefs referenced (over-use
    // tracking). Best-effort — never blocks the stage.
    if (def.key === "creativeBriefs") {
      await recordBrollSuggestions(JSON.stringify(output), "creative_briefs", runId);
    }
  }

  // Apply the verification system to what we just generated.
  const verification = await verifyStageOutput(output);

  // Re-read before writing so a sibling stage finished during our model call isn't
  // clobbered — patch only this stage's key onto the freshest doc.
  const freshDoc = await reloadDoc(runId, doc);
  freshDoc.stages[stageKey] = output;
  freshDoc.verification = { ...(freshDoc.verification ?? {}), [stageKey]: verification };
  const upd = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(freshDoc) })
    .eq("id", runId)
    .eq("type", "pipeline");
  if (upd.error) throw new Error(upd.error.message);

  revalidatePath(`/pipeline/${runId}`);
  return { output, verification };
}

// ─── Progressive deep-dive pass (G2) ──────────────────────────────────────────
// Runs ONE bounded pass of the deep dive: scrape fresh material (rotated so each
// pass finds new voices), mine NEW real verbatims, dedupe-merge into the persisted
// accumulator, and report progress. The client loops this until `done` — reaching
// the tier's target (Soft 100 / Medium 350 / High 1000) with no re-clicking. Every
// pass is persisted, so an interrupted run resumes exactly where it left off.
export async function runDeepDivePass(runId: string, depth: DeepDiveDepth): Promise<DeepDiveProgress> {
  const cfg = deepDiveDepthConfig(depth);

  const row = unwrapOpt(
    await supabase.from("Research").select("*").eq("id", runId).eq("type", "pipeline").maybeSingle(),
  ) as ResearchRow | null;
  if (!row) throw new Error("Pipeline run not found.");
  const doc = parseDoc(row.drafts);

  const ctx = await loadAvatarContext(doc.subAvatarId);
  const acc = asAccumulator(doc.stages.deepDive, depth, cfg.target);

  // Already at (or past) target, or the safety cap is hit → finalize without a call.
  if (acc.threads.length >= cfg.target || acc.passes >= cfg.maxPasses) {
    acc.done = true;
    if (!acc.synthesis) acc.synthesis = (await synthesizeDeepDive(ctx, acc, runId)) ?? undefined;
    const freshDoc = await reloadDoc(runId, doc);
    freshDoc.stages.deepDive = acc;
    const fin = await supabase
      .from("Research")
      .update({ drafts: JSON.stringify(freshDoc) })
      .eq("id", runId)
      .eq("type", "pipeline");
    if (fin.error) throw new Error(fin.error.message);
    return { collected: acc.threads.length, target: cfg.target, passes: acc.passes, added: 0, done: true, depth, output: acc };
  }

  const passIndex = acc.passes;
  const llm = getLLM();

  // Rotate subreddits + query modifiers by pass so each pass surfaces new material.
  const subsAll = subredditsForAngle({
    slug: ctx.angle.slug,
    name: ctx.angle.name,
    mechanism: ctx.angle.mechanism,
    requiredKeyword: ctx.angle.requiredKeyword,
    focus: ctx.sub.name,
  });
  const subs = rotate(subsAll, passIndex);
  const mod = PASS_QUERY_MODIFIERS[passIndex % PASS_QUERY_MODIFIERS.length] ?? "";
  const queries = [
    `${ctx.sub.name} ${mod}`.trim(),
    `${ctx.angle.name} ${mod}`.trim(),
    `${ctx.angle.requiredKeyword} ${mod}`.trim(),
    `${ctx.angle.name} ${ctx.angle.requiredKeyword}`,
  ].filter(Boolean);
  const ytQueries = youtubeQueriesFor(ctx, passIndex);

  const [reddit, ytThreads] = await Promise.all([
    gatherRedditVerbatims(queries, { subreddits: subs, maxThreads: cfg.maxThreads, maxChars: cfg.maxChars }),
    fetchYouTubeThreads(ytQueries, { maxVideos: cfg.maxVideos, maxComments: cfg.maxComments }),
  ]);
  const youtube = formatYouTubeThreads(ytThreads);

  // Feed a recent sample of collected quotes so the model avoids re-reporting them.
  const sample = acc.verbatims
    .slice(-60)
    .map((v) => `- ${v.text.slice(0, 140)}`)
    .join("\n");

  const userPrompt = [
    BRAND_BASE,
    researchBlock(ctx),
    `AVATAR TO DEEP-DIVE: ${ctx.sub.name}${ctx.sub.shortDesc ? ` — ${ctx.sub.shortDesc}` : ""}`,
    `PROGRESS: ${acc.threads.length}/${cfg.target} distinct threads read so far (${acc.verbatims.length} verbatims mined). This is pass ${passIndex + 1}. Read as many NEW threads as you can and mine their quotes.`,
    "Search the web NOW, open fresh threads, and return ONLY the JSON object described in the system prompt.",
    sample ? `ALREADY COLLECTED — do NOT re-report these or near-duplicates of them:\n${sample}` : "",
    renderSubredditBlock(subs),
    verbatimBlock("REAL REDDIT VERBATIMS", reddit),
    verbatimBlock("REAL YOUTUBE COMMENTS", youtube),
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: DEEP_DIVE_PASS_INSTRUCTION,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: cfg.perPassOutputTokens,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "pipeline_g2_deep_dive",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { runId, stage: "deepDive", subAvatarId: ctx.sub.id, pass: passIndex + 1, depth },
  });

  let parsed: DeepDivePassResult = {};
  const text = resp.text ?? "";
  if (text.trim()) {
    try {
      parsed = extractJsonObject<DeepDivePassResult>(text);
    } catch {
      parsed = {};
    }
  }

  // Merge new verbatims (the deliverable content), deduped near-exact against all so far.
  const newVerbatims: DeepDiveVerbatim[] = [];
  const seenTexts = acc.verbatims.map((v) => v.text);
  for (const nv of parsed.verbatims ?? []) {
    const t = typeof nv?.text === "string" ? nv.text.trim() : "";
    if (!t) continue;
    if (isNearDuplicate(t, seenTexts, 0.85)) continue;
    const vb: DeepDiveVerbatim = {
      text: t,
      source: typeof nv.source === "string" ? nv.source : undefined,
      speaker: typeof nv.speaker === "string" ? nv.speaker : undefined,
      category: typeof nv.category === "string" ? nv.category : undefined,
      theme: typeof nv.theme === "string" ? nv.theme : undefined,
    };
    acc.verbatims.push(vb);
    newVerbatims.push(vb);
    seenTexts.push(t);
  }

  // The tier metric is distinct THREADS read. Count them deterministically from the
  // real YouTube threads + the scraped Reddit blob (each block carries its permalink)
  // + the model's reported threadsRead + any new verbatim source URLs.
  const threadCandidates: DeepDiveSourceThread[] = [
    ...extractUrls(reddit).map((url) => ({ url, platform: "reddit" })),
    ...ytThreads.map((t) => ({ url: t.url, title: t.title, platform: "youtube" })),
    ...(parsed.threadsRead ?? []).flatMap((t) =>
      typeof t?.url === "string" && t.url.trim()
        ? [{
            url: t.url.trim(),
            title: typeof t.title === "string" ? t.title : undefined,
            platform: typeof t.platform === "string" ? t.platform : undefined,
          }]
        : [],
    ),
    ...(parsed.verbatims ?? []).flatMap((v) =>
      typeof v?.source === "string" && v.source.trim() ? [{ url: v.source.trim() }] : [],
    ),
  ];
  const added = mergeThreads(acc, threadCandidates);
  // Attach the relevant comments to each thread: real YouTube comments + mined quotes.
  attachCommentsToThreads(acc, ytThreads, newVerbatims);

  if (!acc.avatar && typeof parsed.avatar === "string") acc.avatar = parsed.avatar;
  acc.bigPatterns = unionStrings(acc.bigPatterns, parsed.bigPatterns);
  acc.painPoints = unionStrings(acc.painPoints, parsed.painPoints);
  acc.desires = unionStrings(acc.desires, parsed.desires);
  acc.fears = unionStrings(acc.fears, parsed.fears);
  acc.objections = unionStrings(acc.objections, parsed.objections);
  acc.dailyLanguage = unionStrings(acc.dailyLanguage, parsed.dailyLanguage);
  acc.outliers = unionStrings(acc.outliers, parsed.outliers);
  acc.subredditsExplored = unionStrings(
    acc.subredditsExplored,
    Array.isArray(parsed.subredditsExplored) ? parsed.subredditsExplored : subs,
  );

  acc.passes = passIndex + 1;
  // Three passes in a row surfacing almost no NEW threads = sources tapped out; stop.
  acc.dryStreak = added < 2 ? acc.dryStreak + 1 : 0;
  acc.done = acc.threads.length >= cfg.target || acc.passes >= cfg.maxPasses || acc.dryStreak >= 3;
  acc.updatedAt = new Date().toISOString();

  // On completion, synthesize the whole corpus into the decision-ready angle brief.
  if (acc.done && !acc.synthesis) acc.synthesis = (await synthesizeDeepDive(ctx, acc, runId)) ?? undefined;

  // No verifyStageOutput here: the deep dive is RESEARCH (verbatim customer quotes),
  // not generated ad copy. Running the marketing claim-scan over real people's words
  // would mislabel their quotes ("get rid of", "cure"…) as our non-compliant claims.
  // Re-read before writing so a sibling stage isn't clobbered by our long call.
  const freshDoc = await reloadDoc(runId, doc);
  freshDoc.stages.deepDive = acc;
  const upd = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(freshDoc) })
    .eq("id", runId)
    .eq("type", "pipeline");
  if (upd.error) throw new Error(upd.error.message);

  revalidatePath(`/pipeline/${runId}`);
  return {
    collected: acc.threads.length,
    target: cfg.target,
    passes: acc.passes,
    added,
    done: acc.done,
    depth,
    output: acc,
  };
}
