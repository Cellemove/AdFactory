// Apify verbatim ingestion — the PURE half (types, actor-payload normalizers,
// the free filter funnel, rankers, fingerprints, LLM-response parsing). No env,
// no fetch, no DB — everything here is unit-testable (src/lib/apify.test.ts).
// Network + token live in src/lib/apify.server.ts; orchestration in
// src/lib/cellumove/verbatim-ingest.server.ts.
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  isUsefulCustomerVerbatim,
  normalizeVerbatimText,
} from "@/lib/cellumove/verified-verbatims";
import { normalizeCategory } from "@/lib/cellumove/verbatim-taxonomy";

export type IngestPlatform = "reddit" | "meta" | "tiktok";

export const INGEST_PLATFORMS: IngestPlatform[] = ["reddit", "meta", "tiktok"];

export interface RawComment {
  platform: IngestPlatform;
  externalId: string;          // comment id
  parentId: string;            // reddit post id / fb post id / tiktok video id
  text: string;
  author: string | null;
  publishedAt: string | null;  // ISO or null
  engagement: number;          // upvotes / likes
  sourceUrl: string;
}

// ─── Actor payload normalizers ───────────────────────────────────────────────
// Every actor's item shape is validated loosely and malformed items are skipped
// (fail-soft): a scraper payload is never worth throwing over. Field aliases
// cover the shapes seen across actor versions.

const str = z.string().min(1);

// trudax/reddit-scraper-lite emits posts and comments as sibling items with a
// dataType discriminator.
const RedditItemSchema = z.object({
  dataType: z.string().optional(),
  id: z.string().optional(),
  parsedId: z.string().optional(),
  url: z.string().optional(),
  postId: z.string().optional(),
  parentId: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  text: z.string().optional(),
  username: z.string().optional(),
  author: z.string().optional(),
  upVotes: z.number().optional(),
  score: z.number().optional(),
  numberOfComments: z.number().optional(),
  numComments: z.number().optional(),
  createdAt: z.string().optional(),
  communityName: z.string().optional(),
}).passthrough();

export interface RedditPostItem {
  id: string;
  url: string;
  title: string;
  score: number;
  numComments: number;
  subreddit: string | null;
}

/**
 * Reddit search works best with short phrases people actually type. Marketing
 * angle names such as "Anti-Cellulite" are useful labels, but poor literal
 * searches, so map the priority research themes to audience vocabulary.
 */
export function redditSearchTerms(input: {
  angleSlug?: string | null;
  angleName?: string | null;
  focus?: string | null;
}): string[] {
  const explicitFocus = input.focus?.trim();
  const topic = [input.angleSlug, input.angleName, input.focus].filter(Boolean).join(" ").toLocaleLowerCase();
  const terms = /lipoedema|lipedema/.test(topic)
    ? ["lipedema", "lipoedema", "lipedema legs", "lipedema pain"]
    : /anti[- ]?cellulite|cellulite/.test(topic)
      ? ["cellulite", "my cellulite", "cellulite treatment", "cellulite legs"]
      : /heavy[- ]?legs?|tired legs?|swollen legs?/.test(topic)
        ? ["heavy legs", "legs feel heavy", "tired aching legs", "swollen legs"]
        : [];
  if (terms.length) return [...new Set([explicitFocus, ...terms].filter((value): value is string => Boolean(value)))];
  const fallback = [input.angleName, input.focus].filter((value): value is string => Boolean(value?.trim())).join(" ").trim();
  return fallback ? [fallback] : ["women leg symptoms"];
}

export function normalizeApifyRedditPosts(items: unknown[]): RedditPostItem[] {
  const out: RedditPostItem[] = [];
  for (const raw of items) {
    const p = RedditItemSchema.safeParse(raw);
    if (!p.success) continue;
    const d = p.data;
    if ((d.dataType ?? "post") !== "post") continue;
    const id = d.parsedId || d.id;
    if (!id || !d.url) continue;
    out.push({
      id,
      url: d.url,
      title: d.title ?? "",
      score: d.upVotes ?? d.score ?? 0,
      numComments: d.numberOfComments ?? d.numComments ?? 0,
      subreddit: d.communityName ?? null,
    });
  }
  return out;
}

export function normalizeApifyRedditComments(items: unknown[]): RawComment[] {
  const out: RawComment[] = [];
  for (const raw of items) {
    const p = RedditItemSchema.safeParse(raw);
    if (!p.success) continue;
    const d = p.data;
    if (d.dataType !== "comment") continue;
    const id = d.parsedId || d.id;
    const text = d.body ?? d.text ?? "";
    if (!id || !text.trim()) continue;
    out.push({
      platform: "reddit",
      externalId: id,
      parentId: d.postId ?? d.parentId ?? "unknown",
      text,
      author: d.username ?? d.author ?? null,
      publishedAt: d.createdAt ?? null,
      engagement: Math.max(0, Math.round(d.upVotes ?? d.score ?? 0)),
      sourceUrl: d.url ?? "",
    });
  }
  return out;
}

const NestedRedditCommentSchema = z.object({
  id: z.string().min(1),
  author: z.string().optional(),
  body: z.string().optional(),
  score: z.number().optional(),
  created_utc: z.union([z.number(), z.string()]).optional(),
  replies: z.array(z.unknown()).optional(),
}).passthrough();

const RedditThreadSchema = z.object({
  id: z.string().min(1),
  permalink: z.string().optional(),
  url: z.string().optional(),
  comments: z.array(z.unknown()).optional(),
}).passthrough();

/** Normalize themineworks/reddit-scraper's nested comment trees. */
export function normalizeNestedRedditComments(items: unknown[]): RawComment[] {
  const out: RawComment[] = [];
  for (const raw of items) {
    const post = RedditThreadSchema.safeParse(raw);
    if (!post.success || !post.data.comments?.length) continue;
    const rawUrl = post.data.permalink ?? post.data.url ?? "";
    const sourceUrl = rawUrl.startsWith("http") ? rawUrl : rawUrl ? `https://www.reddit.com${rawUrl}` : "";
    const visit = (comments: unknown[]) => {
      for (const value of comments) {
        const parsed = NestedRedditCommentSchema.safeParse(value);
        if (!parsed.success) continue;
        const comment = parsed.data;
        const body = comment.body?.trim() ?? "";
        if (body && body !== "[deleted]" && body !== "[removed]") {
          const epoch = typeof comment.created_utc === "string" ? Number(comment.created_utc) : comment.created_utc;
          out.push({
            platform: "reddit",
            externalId: comment.id,
            parentId: post.data.id,
            text: body,
            author: comment.author ?? null,
            publishedAt: Number.isFinite(epoch) ? new Date((epoch as number) * 1000).toISOString() : null,
            engagement: Math.max(0, Math.round(comment.score ?? 0)),
            sourceUrl,
          });
        }
        if (comment.replies?.length) visit(comment.replies);
      }
    };
    visit(post.data.comments);
  }
  return out;
}

// apify/facebook-comments-scraper
const FacebookCommentSchema = z.object({
  id: z.string().optional(),
  commentId: z.string().optional(),
  text: z.string().optional(),
  date: z.string().optional(),
  createdTime: z.string().optional(),
  likesCount: z.union([z.number(), z.string()]).optional(),
  commentUrl: z.string().optional(),
  url: z.string().optional(),
  profileName: z.string().optional(),
  authorName: z.string().optional(),
  facebookId: z.string().optional(),
  postId: z.string().optional(),
}).passthrough();

export function normalizeFacebookComments(items: unknown[], postUrl: string): RawComment[] {
  const out: RawComment[] = [];
  for (const raw of items) {
    const p = FacebookCommentSchema.safeParse(raw);
    if (!p.success) continue;
    const d = p.data;
    const id = d.id ?? d.commentId;
    if (!id || !d.text?.trim()) continue;
    const likes = typeof d.likesCount === "string" ? Number(d.likesCount) || 0 : d.likesCount ?? 0;
    out.push({
      platform: "meta",
      externalId: id,
      parentId: d.postId ?? d.facebookId ?? postUrl,
      text: d.text,
      author: d.profileName ?? d.authorName ?? null,
      publishedAt: d.date ?? d.createdTime ?? null,
      engagement: Math.max(0, Math.round(likes)),
      sourceUrl: d.commentUrl ?? d.url ?? postUrl,
    });
  }
  return out;
}

// clockworks/tiktok-scraper (video search)
const TiktokVideoSchema = z.object({
  id: str,
  webVideoUrl: z.string().optional(),
  playCount: z.number().optional(),
  diggCount: z.number().optional(),
  commentCount: z.number().optional(),
  textLanguage: z.string().optional(),
}).passthrough();

export interface TiktokVideoItem {
  id: string;
  url: string;
  plays: number;
  likes: number;
  commentCount: number;
  language: string | null;
}

export function normalizeTiktokVideos(items: unknown[]): TiktokVideoItem[] {
  const out: TiktokVideoItem[] = [];
  for (const raw of items) {
    const p = TiktokVideoSchema.safeParse(raw);
    if (!p.success || !p.data.webVideoUrl) continue;
    const d = p.data;
    out.push({
      id: d.id,
      url: d.webVideoUrl!,
      plays: d.playCount ?? 0,
      likes: d.diggCount ?? 0,
      commentCount: d.commentCount ?? 0,
      language: d.textLanguage ?? null,
    });
  }
  return out;
}

// clockworks/tiktok-comments-scraper
const TiktokCommentSchema = z.object({
  cid: z.string().optional(),
  id: z.string().optional(),
  text: z.string().optional(),
  diggCount: z.number().optional(),
  uniqueId: z.string().optional(),
  createTimeISO: z.string().optional(),
  videoWebUrl: z.string().optional(),
}).passthrough();

export function normalizeTiktokComments(items: unknown[], videoId: string, videoUrl: string): RawComment[] {
  const out: RawComment[] = [];
  for (const raw of items) {
    const p = TiktokCommentSchema.safeParse(raw);
    if (!p.success) continue;
    const d = p.data;
    const id = d.cid ?? d.id;
    if (!id || !d.text?.trim()) continue;
    out.push({
      platform: "tiktok",
      externalId: id,
      parentId: videoId,
      text: d.text,
      author: d.uniqueId ?? null,
      publishedAt: d.createTimeISO ?? null,
      engagement: Math.max(0, Math.round(d.diggCount ?? 0)),
      sourceUrl: d.videoWebUrl ?? videoUrl,
    });
  }
  return out;
}

// ─── Stage 1: free noise gate ────────────────────────────────────────────────
// Social-comment noise the YouTube-era gate never saw. Runs BEFORE
// isUsefulCustomerVerbatim so obviously-worthless comments die instantly.

const LAUGHTER_EMOJIS = new Set(["💀", "😂", "🤣", "😭"]);
const MENTION_ONLY = /^[\s@\w.,!?]*@\w[\w.]*[\s@\w.,!?]*$/;
const ENGAGEMENT_BAIT = /^(?:first|second|early|pin (me|this)|who'?s (here|watching)|anyone (else )?(here|watching)|notification (squad|gang))(?: in \d{4})?[\s!.]*$/i;
const CREATOR_PRAISE = /^(?:i )?(?:love|luv|adore)\s+(?:you|u|your (videos?|content|page|channel))\b[\s\S]{0,40}$/i;

function emojiRatio(text: string): number {
  const chars = [...text.trim()];
  if (!chars.length) return 0;
  const emoji = chars.filter((c) => /\p{Extended_Pictographic}/u.test(c)).length;
  return emoji / chars.length;
}

function isLaughingOnly(text: string): boolean {
  const tokens = text
    .toLocaleLowerCase("en")
    .split(/[\s.,!?;:，。…]+/u)
    .filter(Boolean);
  return tokens.length > 0 && tokens.every(isLaughterToken);
}

function isLaughterToken(token: string): boolean {
  const letters = [...token].filter((char) => !LAUGHTER_EMOJIS.has(char)).join("");
  if (!letters) return true;
  if (letters === "rofl" || letters === "omg" || letters === "dead") return true;
  if (isExtendedEnding(letters, "lma") || isExtendedEnding(letters, "lmfa")) return true;
  if (isLolSequence(letters)) return true;
  return isHaSequence(letters);
}

function isExtendedEnding(value: string, prefix: string): boolean {
  if (!value.startsWith(prefix) || value.length === prefix.length) return false;
  for (let index = prefix.length; index < value.length; index += 1) {
    if (value[index] !== "o") return false;
  }
  return true;
}

function isLolSequence(value: string): boolean {
  let index = 0;
  while (value[index] === "l") index += 1;
  if (index === 0) return false;
  const firstO = index;
  while (value[index] === "o") index += 1;
  if (index === firstO) return false;
  const finalL = index;
  while (value[index] === "l") index += 1;
  return index > finalL && index === value.length;
}

function isHaSequence(value: string): boolean {
  let index = value[0] === "a" ? 1 : 0;
  let syllables = 0;
  while (index < value.length) {
    if (value[index] !== "h") return false;
    index += 1;
    if (index === value.length) return syllables > 0;
    if (value[index] !== "a" && value[index] !== "e") return false;
    syllables += 1;
    index += 1;
  }
  return syllables > 0;
}

export function isPlatformNoise(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return true;
  if (emojiRatio(clean) > 0.5) return true;
  if (isLaughingOnly(clean)) return true;
  if (ENGAGEMENT_BAIT.test(clean)) return true;
  if (CREATOR_PRAISE.test(clean)) return true;
  // Mention-only: contains an @handle and nothing of substance besides it.
  if (/@\w/.test(clean) && MENTION_ONLY.test(clean) && normalizeVerbatimText(clean).split(" ").filter(Boolean).length <= 6) return true;
  return false;
}

// First-person markers in the non-English markets the ads run in (PT/ES/FR/DE/IT).
// The full English gate (isUsefulCustomerVerbatim) requires English first-person
// + English niche terms, which kills every foreign-language comment; these pass
// on length/spam checks alone and the LLM stage judges relevance in-language.
const NON_EN_FIRST_PERSON =
  /\b(eu|minha|minhas|meu|meus|sinto|senti|recebi|comprei|estou|tenho|adoro|je|j'ai|mon|ma|mes|moi|ich|mein|meine|mir|mich|yo|mi|mis|siento|compr[eé]|tengo|io|mio|mia)\b/i;

function passesBasicFloors(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = normalizeVerbatimText(clean).split(" ").filter(Boolean);
  if (words.length < 8 || words.length > 180) return false;
  if (clean.length < 35 || clean.length > 1200) return false;
  if (/https?:\/\/|www\./i.test(clean)) return false;
  return true;
}

// Noise gate + the standing quality gate + in-batch lexical dedupe.
export function gateComments(comments: RawComment[]): { kept: RawComment[]; killed: number } {
  const seen = new Set<string>();
  const kept: RawComment[] = [];
  for (const c of comments) {
    if (isPlatformNoise(c.text)) continue;
    const passes =
      isUsefulCustomerVerbatim(c.text) ||
      (NON_EN_FIRST_PERSON.test(c.text) && passesBasicFloors(c.text));
    if (!passes) continue;
    const key = normalizeVerbatimText(c.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return { kept, killed: comments.length - kept.length };
}

// ─── Targeting rankers — only pay for comments on posts worth scraping ──────

export function rankRedditPosts<T extends { score: number; numComments: number }>(posts: T[], max: number): T[] {
  return posts
    .filter((p) => p.numComments >= 5)
    .sort((a, b) => b.score + 2 * b.numComments - (a.score + 2 * a.numComments))
    .slice(0, Math.max(0, max));
}

export function rankTiktokVideos(videos: TiktokVideoItem[], max: number): TiktokVideoItem[] {
  return videos
    .filter((v) => v.commentCount >= 10)
    .sort((a, b) => b.plays + 10 * b.likes - (a.plays + 10 * a.likes))
    .slice(0, Math.max(0, max));
}

// ─── Fingerprints ────────────────────────────────────────────────────────────
// Mirrors the YouTube fingerprint shape (videoId:commentId:normalizedText) with
// the platform prefixed so ids can't collide across sources.
export function commentFingerprint(
  c: Pick<RawComment, "platform" | "parentId" | "externalId">,
  normalizedText: string,
): string {
  return createHash("sha256")
    .update(`${c.platform}:${c.parentId}:${c.externalId}:${normalizedText}`)
    .digest("hex");
}

// ─── Stage 3: LLM classification parsing ─────────────────────────────────────

export const ClassifyResponseSchema = z.object({
  results: z.array(z.object({
    i: z.number().int(),
    keep: z.boolean(),
    category: z.string().optional(),
  })),
});

/**
 * Applies a Flash keep/categorize response to its batch. Returns null when the
 * response is unparseable — the caller fails soft (the batch already passed the
 * deterministic gates). Out-of-range indexes are ignored.
 */
export function applyClassification(
  batch: RawComment[],
  parsed: unknown,
): { kept: Array<RawComment & { category: string }>; killed: number } | null {
  const res = ClassifyResponseSchema.safeParse(parsed);
  if (!res.success) return null;
  const kept: Array<RawComment & { category: string }> = [];
  for (const r of res.data.results) {
    const comment = batch[r.i];
    if (!comment || !r.keep) continue;
    kept.push({ ...comment, category: normalizeCategory(r.category ?? "") });
  }
  return { kept, killed: batch.length - kept.length };
}
