// Apify verbatim ingestion orchestrator: targeted scrape → four-stage funnel →
// verified Verbatim rows. Money rules: never pay for discovery we already have
// (subreddit clusters, own ad posts), hard maxItems caps on every actor call, a
// cumulative actual-USD stop, and a scrape ledger so re-runs never re-pay for a
// post/video already scraped.
import "server-only";
import { supabase, newId } from "@/lib/db";
import { getLLM, FAST_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { filterNovel } from "@/lib/cellumove/novelty";
import {
  classifyVerbatimCategory,
  normalizeVerbatimText,
  VERIFIED_VERBATIM_PREFIX,
} from "@/lib/cellumove/verified-verbatims";
import { computeSourceWeight, VERBATIM_CATEGORIES } from "@/lib/cellumove/verbatim-taxonomy";
import { isFbPostUrl } from "@/lib/fb-post";
import type { SheetWinnersDoc } from "@/lib/cellumove/sheet-winners";
import {
  applyClassification,
  commentFingerprint,
  gateComments,
  normalizeNestedRedditComments,
  normalizeFacebookComments,
  normalizeTiktokComments,
  normalizeTiktokVideos,
  redditSearchTerms,
  rankTiktokVideos,
  type IngestPlatform,
  type RawComment,
} from "@/lib/apify";
import { APIFY_ACTORS, apifyMaxUsdPerRun, runActorAndGetItems } from "@/lib/apify.server";

const SOURCE_TYPE_BY_PLATFORM: Record<IngestPlatform, string> = {
  reddit: "reddit_comment",
  meta: "meta_comment",
  tiktok: "tiktok_comment",
};

const CLASSIFY_BATCH_SIZE = 40;

export interface IngestSummary {
  platform: IngestPlatform;
  scraped: number;
  killedGate: number;
  killedDedupe: number;
  killedLLM: number;
  inserted: number;
  estUsd: number;
  warnings: string[];
}

export interface IngestInput {
  platform: IngestPlatform;
  angleSlug: string | null;
  subAvatarId: string | null;
  angleName: string;
  mechanism?: string | null;
  focus?: string | null;
  market?: string | null;
  targetUrls?: string[];
  maxPosts?: number;
  maxCommentsPerPost?: number;
  maxUsd?: number;
  force?: boolean;
}

function migrationHint(message: string): Error {
  return new Error(`${message} — did you run migrations/019_apify_verbatims.sql in the Supabase SQL editor?`);
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

async function ledgerScrapedIds(platform: IngestPlatform, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const res = await supabase
    .from("VerbatimScrapeTarget")
    .select("externalId")
    .eq("platform", platform)
    .in("externalId", ids.slice(0, 200));
  if (res.error) {
    if (res.error.code === "PGRST205") throw migrationHint("The scrape ledger table is missing");
    return new Set();
  }
  return new Set(((res.data ?? []) as { externalId: string }[]).map((r) => r.externalId));
}

async function ledgerRecord(rows: Array<{
  platform: IngestPlatform;
  externalId: string;
  url: string;
  angleSlug: string | null;
  commentCount: number;
  keptCount: number;
  costUsd: number | null;
}>): Promise<void> {
  if (!rows.length) return;
  const res = await supabase.from("VerbatimScrapeTarget").upsert(
    rows.map((r) => ({ id: newId(), ...r, status: "scraped", scrapedAt: new Date().toISOString() })),
    { onConflict: "platform,externalId" },
  );
  if (res.error) console.warn("[verbatim-ingest] ledger write failed:", res.error.message);
}

// ─── Funnel stages 2–4 ───────────────────────────────────────────────────────

// Mirrors loadExistingVerbatimTexts in actions/verbatims.ts (private there).
async function existingScopeTexts(scope: { subAvatarId: string | null; angleSlug: string | null }): Promise<string[]> {
  try {
    let q = supabase.from("Verbatim").select("text").like("researchId", `${VERIFIED_VERBATIM_PREFIX}%`);
    if (scope.subAvatarId) q = q.eq("subAvatarId", scope.subAvatarId);
    else if (scope.angleSlug) q = q.eq("angleSlug", scope.angleSlug);
    const res = await q.order("createdAt", { ascending: false }).limit(1000);
    return res.error ? [] : ((res.data ?? []) as { text: string }[]).map((r) => r.text).filter(Boolean);
  } catch {
    return [];
  }
}

async function dropOwnedFingerprints(
  comments: Array<RawComment & { fingerprint: string }>,
): Promise<Array<RawComment & { fingerprint: string }>> {
  const out: Array<RawComment & { fingerprint: string }> = [];
  for (let i = 0; i < comments.length; i += 200) {
    const chunk = comments.slice(i, i + 200);
    const res = await supabase
      .from("Verbatim")
      .select("sourceFingerprint")
      .in("sourceFingerprint", chunk.map((c) => c.fingerprint));
    if (res.error) {
      if (res.error.code === "PGRST204" || /sourceFingerprint/.test(res.error.message)) {
        throw migrationHint("Verbatim.sourceFingerprint is missing");
      }
      out.push(...chunk);
      continue;
    }
    const owned = new Set(((res.data ?? []) as { sourceFingerprint: string | null }[]).map((r) => r.sourceFingerprint));
    out.push(...chunk.filter((c) => !owned.has(c.fingerprint)));
  }
  return out;
}

function classifyPrompt(input: IngestInput, batch: RawComment[]): string {
  return [
    "You are curating VERBATIMS — real customer language — for CelluMove, a DTC compression/shaping leggings brand for women.",
    `Topic angle: ${input.angleName}${input.mechanism ? ` (mechanism: ${input.mechanism})` : ""}${input.focus ? ` · focus: ${input.focus}` : ""}.`,
    "For each numbered comment decide KEEP or DROP.",
    "KEEP only a real person describing their OWN experience relevant to this niche: their pain or symptom, their desire, an objection or past disappointment, a false belief about the cause/solution, the trigger moment that made them look for a fix, their own words for the problem, or their own theory of how the problem works.",
    "DROP: jokes and banter, praise for the creator or video, spam or promotion, secondhand or generic advice, questions with no experience in them, and anything off-niche.",
    "Comments may be in ANY language (Portuguese, Spanish, French...). Judge them in their own language — a genuine own-experience comment in Portuguese is a KEEP. Never translate; the verbatim stays as written.",
    "For each KEEP, assign ONE category:",
    ...VERBATIM_CATEGORIES.map((c) => `- ${c.slug}: ${c.description}`),
    "",
    "COMMENTS:",
    JSON.stringify(batch.map((c, i) => ({ i, text: c.text.slice(0, 800) }))),
    "",
    'Return EXACTLY one JSON object: {"results":[{"i":0,"keep":true,"category":"primary_pain"}]} — one entry per comment, no prose.',
  ].join("\n");
}

async function classifyBatches(
  input: IngestInput,
  comments: Array<RawComment & { fingerprint: string }>,
  warnings: string[],
): Promise<{ kept: Array<RawComment & { fingerprint: string; category: string }>; killed: number }> {
  const kept: Array<RawComment & { fingerprint: string; category: string }> = [];
  let killed = 0;
  const llm = getLLM();
  for (let i = 0; i < comments.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = comments.slice(i, i + CLASSIFY_BATCH_SIZE);
    try {
      const resp = await llm.models.generateContent({
        model: FAST_MODEL,
        contents: classifyPrompt(input, batch),
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      await recordUsage({
        feature: "verbatim_ingest_classify",
        model: FAST_MODEL,
        usage: resp.usageMetadata,
        metadata: { platform: input.platform, batch: batch.length },
      });
      const applied = applyClassification(batch, JSON.parse(resp.text ?? "null"));
      if (!applied) throw new Error("unparseable classification response");
      // Re-attach fingerprints (applyClassification is generic over RawComment).
      const byId = new Map(batch.map((c) => [`${c.parentId}:${c.externalId}`, c.fingerprint]));
      for (const c of applied.kept) {
        kept.push({ ...c, fingerprint: byId.get(`${c.parentId}:${c.externalId}`)! });
      }
      killed += applied.killed;
    } catch (e) {
      // Fail soft: the batch already passed the deterministic gates — keep it
      // with the regex classifier rather than losing paid-for comments.
      warnings.push(`Classifier batch fell back to regex categories (${e instanceof Error ? e.message : e}).`);
      for (const c of batch) kept.push({ ...c, category: classifyVerbatimCategory(c.text) });
    }
  }
  return { kept, killed };
}

async function insertVerbatims(
  input: IngestInput,
  rows: Array<RawComment & { fingerprint: string; category: string }>,
): Promise<number> {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const sourceType = SOURCE_TYPE_BY_PLATFORM[input.platform];
  const res = await supabase
    .from("Verbatim")
    .upsert(
      rows.map((c) => ({
        id: newId(),
        angleSlug: input.angleSlug,
        subAvatarId: input.subAvatarId,
        category: c.category,
        text: c.text.replace(/\s+/g, " ").trim(),
        sourceType,
        sourceUrl: c.sourceUrl || null,
        engagementScore: c.engagement,
        sourceWeight: computeSourceWeight(sourceType, c.engagement),
        market: input.market ?? null,
        researchId: `${VERIFIED_VERBATIM_PREFIX}apify-${input.platform}`,
        sourceAuthor: c.author,
        sourcePublishedAt: c.publishedAt,
        sourceFingerprint: c.fingerprint,
        createdAt: now,
      })),
      { onConflict: "sourceFingerprint", ignoreDuplicates: true },
    )
    .select("id");
  if (res.error) {
    if (res.error.code === "PGRST204" || /sourceFingerprint|sourceAuthor/.test(res.error.message)) {
      throw migrationHint("Verbatim provenance columns are missing");
    }
    throw new Error(res.error.message);
  }
  return (res.data ?? []).length;
}

// ─── Platform scrapes (targets → RawComment[] + ledger rows) ─────────────────

interface ScrapeResult {
  comments: RawComment[];
  targets: Array<{ externalId: string; url: string; commentCount: number }>;
  usd: number;
}

// Search discussion-rich posts, then flatten their nested comment trees. This
// avoids the old actor's six sequential browser runs and keeps the expensive
// unit (posts) small while yielding hundreds of first-person candidates.
async function scrapeReddit(
  input: IngestInput,
  maxPosts: number,
  maxComments: number,
  budgetLeft: () => number,
  spend: (actorId: string, usd: number, runId: string, items: number) => Promise<void>,
): Promise<ScrapeResult> {
  const queries = redditSearchTerms(input);
  if (budgetLeft() <= 0) return { comments: [], targets: [], usd: 0 };
  const postCap = Math.min(100, maxPosts);
  const run = await runActorAndGetItems({
    actorId: APIFY_ACTORS.reddit(),
    input: {
      mode: "search",
      // Do not OR loose aliases such as "my cellulite" and "cellulite legs":
      // Reddit tokenizes them and the generic words swamp the result set.
      searchQuery: queries[0]!.includes(" ") ? `"${queries[0]}"` : queries[0],
      sortBy: "top",
      timeframe: "all",
      maxPosts: postCap,
      includeComments: true,
      maxCommentsPerPost: maxComments,
      maxDepth: 3,
      monitorMode: false,
    },
    maxItems: postCap + 1,
    timeoutSecs: 300,
  });
  await spend(APIFY_ACTORS.reddit(), run.usd, run.runId, run.items.length);

  const comments = normalizeNestedRedditComments(run.items);
  const byParent = new Map<string, { url: string; count: number }>();
  for (const comment of comments) {
    const current = byParent.get(comment.parentId);
    byParent.set(comment.parentId, { url: current?.url || comment.sourceUrl, count: (current?.count ?? 0) + 1 });
  }
  const targets = [...byParent].map(([externalId, value]) => ({ externalId, url: value.url, commentCount: value.count }));
  return { comments, targets, usd: 0 }; // usd already recorded via spend()
}

// Own winning-ad FB post links + banked FB post links — the posts whose comment
// sections talk about exactly this product.
async function ownMetaPostUrls(): Promise<string[]> {
  const urls = new Set<string>();
  try {
    const res = await supabase
      .from("Research")
      .select("drafts")
      .eq("type", "sheet_winners")
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!res.error && res.data) {
      const doc = JSON.parse((res.data as { drafts: string }).drafts) as SheetWinnersDoc;
      for (const w of doc.winners ?? []) if (isFbPostUrl(w.postLink)) urls.add(w.postLink!);
    }
  } catch { /* fail soft */ }
  try {
    const res = await supabase.from("BankedAd").select("sourceUrl").limit(500);
    if (!res.error) {
      for (const r of (res.data ?? []) as { sourceUrl: string }[]) if (isFbPostUrl(r.sourceUrl)) urls.add(r.sourceUrl);
    }
  } catch { /* fail soft */ }
  return [...urls];
}

async function scrapeMeta(input: IngestInput, maxPosts: number, maxComments: number): Promise<ScrapeResult> {
  const pasted = (input.targetUrls ?? []).filter(isFbPostUrl);
  const candidates = [...new Set([...pasted, ...(await ownMetaPostUrls())])];
  if (!candidates.length) {
    throw new Error(
      "No Facebook post URLs to scrape. Paste post permalinks (facebook.com/.../posts/... — Ads Library links have no comments), or import winning ads with post links first.",
    );
  }
  const scraped = input.force ? new Set<string>() : await ledgerScrapedIds("meta", candidates);
  const targets = candidates.filter((u) => !scraped.has(u)).slice(0, maxPosts);
  if (!targets.length) return { comments: [], targets: [], usd: 0 };
  const run = await runActorAndGetItems({
    actorId: APIFY_ACTORS.fbComments(),
    input: {
      startUrls: targets.map((url) => ({ url })),
      resultsLimit: maxComments,
      includeNestedComments: false,
      viewOption: "RANKED_UNFILTERED",
    },
    maxItems: targets.length * maxComments,
  });
  const comments = normalizeFacebookComments(run.items, targets[0] ?? "");
  // Attribute counts per target where the item names its post; leftovers land
  // on the first target — the ledger only needs "was scraped" + rough counts.
  const counts = new Map<string, number>(targets.map((t) => [t, 0]));
  for (const c of comments) {
    const hit = targets.find((t) => c.parentId === t || c.sourceUrl.startsWith(t));
    counts.set(hit ?? targets[0]!, (counts.get(hit ?? targets[0]!) ?? 0) + 1);
  }
  return {
    comments,
    targets: targets.map((url) => ({ externalId: url, url, commentCount: counts.get(url) ?? 0 })),
    usd: run.usd,
  };
}

async function scrapeTiktok(
  input: IngestInput,
  maxPosts: number,
  maxComments: number,
  budgetLeft: () => number,
  spend: (actorId: string, usd: number, runId: string, items: number) => Promise<void>,
): Promise<ScrapeResult> {
  const query = [input.angleName, input.focus ?? ""].join(" ").trim();
  const search = await runActorAndGetItems({
    actorId: APIFY_ACTORS.tiktokSearch(),
    input: { searchQueries: [query], resultsPerPage: 15 },
    maxItems: 15,
  });
  await spend(APIFY_ACTORS.tiktokSearch(), search.usd, search.runId, search.items.length);
  const videos = normalizeTiktokVideos(search.items).filter((v) => !v.language || v.language === "en");
  const scraped = input.force ? new Set<string>() : await ledgerScrapedIds("tiktok", videos.map((v) => v.id));
  const top = rankTiktokVideos(videos.filter((v) => !scraped.has(v.id)), Math.min(maxPosts, 5));
  if (!top.length || budgetLeft() <= 0) return { comments: [], targets: [], usd: 0 };
  const run = await runActorAndGetItems({
    actorId: APIFY_ACTORS.tiktokComments(),
    input: { postURLs: top.map((v) => v.url), commentsPerPost: maxComments },
    maxItems: top.length * maxComments,
  });
  const urlToVideo = new Map(top.map((v) => [v.url, v]));
  const byVideo = new Map<string, unknown[]>();
  for (const item of run.items) {
    const url = (item as { videoWebUrl?: string }).videoWebUrl ?? top[0]!.url;
    (byVideo.get(url) ?? byVideo.set(url, []).get(url)!).push(item);
  }
  const comments: RawComment[] = [];
  for (const [url, items] of byVideo) {
    const video = urlToVideo.get(url) ?? top[0]!;
    comments.push(...normalizeTiktokComments(items, video.id, video.url));
  }
  return {
    comments,
    targets: top.map((v) => ({ externalId: v.id, url: v.url, commentCount: comments.filter((c) => c.parentId === v.id).length })),
    usd: run.usd,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function ingestPlatformVerbatims(input: IngestInput): Promise<IngestSummary> {
  const maxPosts = Math.min(20, Math.max(1, input.maxPosts ?? 8));
  const maxComments = Math.min(100, Math.max(5, input.maxCommentsPerPost ?? 40));
  const maxUsd = Math.min(20, input.maxUsd ?? apifyMaxUsdPerRun());
  const warnings: string[] = [];
  let spentUsd = 0;

  const spend = async (actorId: string, usd: number, runId: string, items: number) => {
    spentUsd += usd;
    await recordUsage({
      feature: "verbatim_ingest_apify",
      model: `apify:${actorId}`,
      usage: null,
      costUsdOverride: usd,
      metadata: { platform: input.platform, runId, items, angleSlug: input.angleSlug ?? undefined },
    });
    if (spentUsd >= maxUsd) warnings.push(`Budget cap $${maxUsd.toFixed(2)} reached — run stopped scheduling further scrapes.`);
  };

  let scrape: ScrapeResult;
  if (input.platform === "reddit") {
    scrape = await scrapeReddit(input, maxPosts, maxComments, () => maxUsd - spentUsd, spend);
  } else if (input.platform === "meta") {
    scrape = await scrapeMeta(input, maxPosts, maxComments);
    if (scrape.usd > 0) await spend(APIFY_ACTORS.fbComments(), scrape.usd, "-", scrape.comments.length);
  } else {
    scrape = await scrapeTiktok(input, maxPosts, maxComments, () => maxUsd - spentUsd, spend);
    if (scrape.usd > 0) await spend(APIFY_ACTORS.tiktokComments(), scrape.usd, "-", scrape.comments.length);
  }

  // Stage 1: free deterministic gates.
  const gated = gateComments(scrape.comments);

  // Stage 2: fingerprint + lexical dedupe against what we already own.
  const withPrints = gated.kept.map((c) => ({ ...c, fingerprint: commentFingerprint(c, normalizeVerbatimText(c.text)) }));
  const unowned = await dropOwnedFingerprints(withPrints);
  const existing = await existingScopeTexts({ subAvatarId: input.subAvatarId, angleSlug: input.angleSlug });
  const { novel } = filterNovel(unowned, existing, (c) => c.text, 0.85);
  const killedDedupe = withPrints.length - novel.length;

  // Stage 3: LLM keep/categorize.
  const classified = await classifyBatches(input, novel, warnings);

  // Stage 4: insert (DB-level fingerprint dedupe backstops everything).
  const inserted = await insertVerbatims(input, classified.kept);

  const keptByTarget = new Map<string, number>();
  for (const c of classified.kept) keptByTarget.set(c.parentId, (keptByTarget.get(c.parentId) ?? 0) + 1);
  await ledgerRecord(scrape.targets.map((t) => ({
    platform: input.platform,
    externalId: t.externalId,
    url: t.url,
    angleSlug: input.angleSlug,
    commentCount: t.commentCount,
    keptCount: keptByTarget.get(t.externalId) ?? 0,
    costUsd: scrape.targets.length ? spentUsd / scrape.targets.length : null,
  })));

  return {
    platform: input.platform,
    scraped: scrape.comments.length,
    killedGate: gated.killed,
    killedDedupe,
    killedLLM: classified.killed,
    inserted,
    estUsd: Math.round(spentUsd * 1000) / 1000,
    warnings,
  };
}
