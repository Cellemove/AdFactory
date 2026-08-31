import { createHash } from "node:crypto";

export type ResearchType = "angle" | "sub_avatar" | "concept";
export type EvidenceType = "verbatim" | "claim" | "inference";
export type EvidenceVerificationStatus = "verified" | "source_checked" | "unverified" | "inference";
export type ResearchSourceType = "real_people" | "real_ad" | "editorial" | "brand" | "unknown";
export type ResearchQualityStatus = "pass" | "review" | "reject";

export interface ResearchEvidenceClaim {
  id?: string;
  category: string;
  text: string;
  type: EvidenceType;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  verificationStatus?: EvidenceVerificationStatus;
}

export interface ResearchQueryFacet {
  category: string;
  intent: string;
  queries: string[];
}

export interface ResearchQueryPlan {
  version: "v1";
  brief: string;
  facets: ResearchQueryFacet[];
}

export interface ResearchQualityReport {
  score: number;
  status: ResearchQualityStatus;
  sourceCount: number;
  liveSourceCount: number;
  distinctDomains: number;
  realPeopleSources: number;
  realAdSources: number;
  evidenceCount: number;
  verifiedVerbatims: number;
  verbatimCount: number;
  blockers: string[];
  warnings: string[];
}

const REAL_PEOPLE_DOMAINS = [
  "reddit.com",
  "quora.com",
  "mumsnet.com",
  "netmums.com",
  "babycenter.com",
  "patient.info",
  "medhelp.org",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "facebook.com",
];

const REAL_AD_DOMAINS = [
  "facebook.com/ads/library",
  "ads.tiktok.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

const BRAND_DOMAINS = ["shopify.com", "myshopify.com"];

export function canonicalizeResearchUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function researchDomain(raw: string): string {
  const canonical = canonicalizeResearchUrl(raw);
  if (!canonical) return "";
  return new URL(canonical).hostname;
}

export function classifyResearchSource(raw: string): ResearchSourceType {
  const canonical = canonicalizeResearchUrl(raw);
  if (!canonical) return "unknown";
  const parsed = new URL(canonical);
  const haystack = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (REAL_AD_DOMAINS.some((domain) => haystack.includes(domain))) return "real_ad";
  if (REAL_PEOPLE_DOMAINS.some((domain) => parsed.hostname.endsWith(domain))) return "real_people";
  if (BRAND_DOMAINS.some((domain) => parsed.hostname.endsWith(domain))) return "brand";
  return "editorial";
}

export function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deterministicResearchId(...parts: Array<string | null | undefined>): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
}

export function normalizeEvidenceClaims(input: unknown): ResearchEvidenceClaim[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ResearchEvidenceClaim[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const category = typeof item.category === "string" ? item.category.trim() : "";
    const type = item.type === "verbatim" || item.type === "claim" || item.type === "inference"
      ? item.type
      : "claim";
    if (!text || !category) continue;
    const sourceUrl = typeof item.sourceUrl === "string" ? canonicalizeResearchUrl(item.sourceUrl) : null;
    const key = `${type}:${normalizeEvidenceText(text)}:${sourceUrl ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      category,
      text,
      type,
      sourceUrl,
      sourceTitle: typeof item.sourceTitle === "string" ? item.sourceTitle.trim() || null : null,
    });
  }
  return out.slice(0, 40);
}

export interface QualityEvaluationInput {
  type: ResearchType;
  sources: Array<{ url: string; ok: boolean }>;
  evidence: ResearchEvidenceClaim[];
}

export function evaluateResearchQuality(input: QualityEvaluationInput): ResearchQualityReport {
  const canonicalSources = [...new Set(input.sources.map((source) => canonicalizeResearchUrl(source.url)).filter(Boolean))] as string[];
  const sourceByUrl = new Map(input.sources.map((source) => [canonicalizeResearchUrl(source.url), source]));
  const liveSourceCount = canonicalSources.filter((url) => sourceByUrl.get(url)?.ok).length;
  const domains = new Set(canonicalSources.map(researchDomain).filter(Boolean));
  const sourceTypes = canonicalSources.map(classifyResearchSource);
  const realPeopleSources = sourceTypes.filter((type) => type === "real_people").length;
  const realAdSources = sourceTypes.filter((type) => type === "real_ad").length;
  const verbatims = input.evidence.filter((item) => item.type === "verbatim");
  const verifiedVerbatims = verbatims.filter((item) => item.verificationStatus === "verified").length;
  const sourcedEvidence = input.evidence.filter((item) => item.type === "inference" || Boolean(item.sourceUrl));

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (canonicalSources.length < 3) blockers.push("Fewer than 3 cited sources.");
  if (liveSourceCount < 2) blockers.push("Fewer than 2 cited sources could be loaded.");
  if (domains.size < 2) blockers.push("Evidence comes from fewer than 2 independent domains.");
  if (sourcedEvidence.length < 3) blockers.push("Fewer than 3 source-linked evidence items.");
  if (verbatims.some((item) => item.verificationStatus !== "verified")) {
    blockers.push("One or more claimed verbatims were not found in their exact cited source.");
  }
  if (input.type === "concept" && realAdSources < 1) blockers.push("Concept research needs at least 1 real-ad source.");
  if (input.type === "concept" && realPeopleSources < 1) blockers.push("Concept research needs at least 1 real-person source.");
  if (input.type !== "concept" && realPeopleSources < 2) warnings.push("Fewer than 2 real-person sources were identified.");
  if (verbatims.length === 0) warnings.push("No exact customer verbatims were supplied.");

  const sourceScore = Math.min(canonicalSources.length / 3, 1) * 15;
  const liveScore = Math.min(liveSourceCount / Math.max(canonicalSources.length, 1), 1) * 20;
  const diversityScore = Math.min(domains.size / 3, 1) * 15;
  const evidenceScore = Math.min(sourcedEvidence.length / 5, 1) * 20;
  const verbatimScore = verbatims.length === 0 ? 5 : (verifiedVerbatims / verbatims.length) * 20;
  const mixSatisfied = input.type === "concept"
    ? realAdSources >= 1 && realPeopleSources >= 1
    : realPeopleSources >= 2;
  const mixScore = mixSatisfied ? 10 : 0;
  const score = Math.max(0, Math.min(100, Math.round(sourceScore + liveScore + diversityScore + evidenceScore + verbatimScore + mixScore)));
  const status: ResearchQualityStatus = blockers.length > 0 ? "reject" : score >= 80 ? "pass" : "review";

  return {
    score,
    status,
    sourceCount: canonicalSources.length,
    liveSourceCount,
    distinctDomains: domains.size,
    realPeopleSources,
    realAdSources,
    evidenceCount: input.evidence.length,
    verifiedVerbatims,
    verbatimCount: verbatims.length,
    blockers,
    warnings,
  };
}

export function reciprocalRankFusion(
  rankedLists: string[][],
  weights: number[] = rankedLists.map(() => 1),
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  rankedLists.forEach((list, listIndex) => {
    const weight = weights[listIndex] ?? 1;
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1)));
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

