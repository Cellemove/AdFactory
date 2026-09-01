import { createHash } from "node:crypto";
import { computeSourceWeight } from "./verbatim-taxonomy";
import type { YTThread } from "@/lib/youtube";

export const VERIFIED_VERBATIM_PREFIX = "verified:";
export const YOUTUBE_VERIFICATION_METHOD = `${VERIFIED_VERBATIM_PREFIX}youtube-data-api-v3`;

export function buildVerifiedVerbatimQueries(input: {
  angleName: string;
  mechanism?: string | null;
  focus?: string | null;
}): string[] {
  const topic = input.angleName.trim();
  const focus = input.focus?.trim();
  return [
    `${topic} women personal experience`,
    `${topic} symptoms what it feels like`,
    focus ? `${topic} ${focus} personal story` : `${topic} treatment results experience`,
    input.mechanism?.trim() ? `${topic} ${input.mechanism} review` : `${topic} confidence daily life`,
  ];
}

export interface VerifiedVerbatimCandidate {
  angleSlug: string | null;
  subAvatarId: string | null;
  category: string;
  text: string;
  sourceType: "youtube_comment";
  sourceUrl: string;
  engagementScore: number;
  sourceWeight: number;
  market: string | null;
  researchId: string;
  sourceAuthor: string;
  sourcePublishedAt: string | null;
  sourceFingerprint: string;
}

const GENERIC_REACTION = /^(great|nice|amazing|awesome|love (this|that|her|it)|thank(s| you)|so (true|good)|well said|exactly|i agree|first|here from|who'?s watching|this helped|very helpful|good video|great video|i approve)\b/i;
const PROMOTIONAL_SPAM = /\b(vital test hub|check (out )?my (channel|profile)|whats\s*app|telegram|dm me|contact (him|her|me)|crypto|forex|investment|promo code|discount code|click (the )?link)\b/i;
const FIRST_PERSON = /\b(i|i'm|i’ve|i've|i’d|i'd|i’ll|i'll|me|my|mine|myself)\b/i;
const EXPERIENCE = /\b(pain|hurt|ache|aching|heavy|swollen|swelling|cellulite|dimple|lump|legs?|thighs?|knees?|skin|body|weight|pregnan|postpartum|menopause|lipedema|lipoedema|pots|varicose|veins?|circulation|compression|socks?|leggings?|mobility|walk|sleep|exercise|workout|confidence|embarrass|ashamed|relief|symptom|doctor|treatment|tried)\b/i;

export function normalizeVerbatimText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulCustomerVerbatim(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = normalizeVerbatimText(clean).split(" ").filter(Boolean);
  if (words.length < 8 || words.length > 180) return false;
  if (clean.length < 35 || clean.length > 1200) return false;
  if (/https?:\/\/|www\./i.test(clean)) return false;
  if (PROMOTIONAL_SPAM.test(clean)) return false;
  if (GENERIC_REACTION.test(clean) && words.length < 35) return false;
  if (!FIRST_PERSON.test(clean)) return false;
  if (!EXPERIENCE.test(clean)) return false;
  return true;
}

export function classifyVerbatimCategory(text: string): string {
  const value = normalizeVerbatimText(text);
  if (/\b(waste|scam|skeptic|didn'?t work|doesn'?t work|never worked|too expensive|not worth|afraid to buy|tried everything)\b/.test(value)) return "objection";
  if (/\b(i thought|i assumed|i believed|because of|caused by|genetic|hormone|metabolism|circulation|water retention|fat cells?)\b/.test(value)) return "perceived_mechanism";
  if (/\b(when i|after i|since i|doctor told|photo of me|tried on|before my|after my|during my|on holiday|on vacation)\b/.test(value)) return "trigger_event";
  if (/\b(i want|i wish|i hope|i would love|i'?d love|my goal|feel confident|wear shorts|wear a dress|feel normal|feel lighter)\b/.test(value)) return "desire";
  if (/\b(they call it|i call it|feels? like|looks? like|my words|best way i can describe)\b/.test(value)) return "vocabulary";
  if (/\b(can'?t sleep|can'?t walk|can'?t stand|at work|end of the day|every day|daily|stairs|sitting|standing)\b/.test(value)) return "secondary_pain";
  if (/\b(pain|hurt|ache|aching|heavy|swollen|swelling|embarrass|ashamed|hate my|miserable|frustrat|dread)\b/.test(value)) return "primary_pain";
  return "vocabulary";
}

export function youtubeCommentUrl(videoId: string, commentId: string): string {
  const params = new URLSearchParams({ v: videoId, lc: commentId });
  return `https://www.youtube.com/watch?${params.toString()}`;
}

export function verifiedCandidatesFromYouTube(input: {
  threads: YTThread[];
  angleSlug?: string | null;
  subAvatarId?: string | null;
  market?: string | null;
}): VerifiedVerbatimCandidate[] {
  const seen = new Set<string>();
  const rows: VerifiedVerbatimCandidate[] = [];
  for (const thread of input.threads) {
    for (const comment of thread.comments) {
      if (!isUsefulCustomerVerbatim(comment.text)) continue;
      const normalized = normalizeVerbatimText(comment.text);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      rows.push({
        angleSlug: input.angleSlug ?? null,
        subAvatarId: input.subAvatarId ?? null,
        category: classifyVerbatimCategory(comment.text),
        text: comment.text.replace(/\s+/g, " ").trim(),
        sourceType: "youtube_comment",
        sourceUrl: youtubeCommentUrl(thread.videoId, comment.id),
        engagementScore: Math.max(0, Math.round(comment.likes || 0)),
        sourceWeight: computeSourceWeight("youtube_comment", comment.likes || 0),
        market: input.market ?? null,
        researchId: YOUTUBE_VERIFICATION_METHOD,
        sourceAuthor: comment.author,
        sourcePublishedAt: comment.publishedAt,
        sourceFingerprint: createHash("sha256").update(`${thread.videoId}:${comment.id}:${normalized}`).digest("hex"),
      });
    }
  }
  return rows;
}

export function isVerifiedVerbatimMarker(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(VERIFIED_VERBATIM_PREFIX));
}
