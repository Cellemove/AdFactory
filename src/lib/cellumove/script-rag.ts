import type { ScriptDocument, ScriptModule } from "@/lib/cellumove/script-studio";

export const SCRIPT_RAG_VERSION = "script-rag-v1";

export type ScriptEvidenceSource =
  | "product"
  | "avatar"
  | "verbatim"
  | "knowledge"
  | "principle"
  | "winning_ad"
  | "pipeline"
  | "teardown";

export interface ScriptRagCandidate {
  id: string;
  source: ScriptEvidenceSource;
  category: string;
  text: string;
  title: string;
  url: string | null;
  verified: boolean;
}

export interface ScriptModuleRetrievalQuery {
  moduleId: string;
  moduleKind: ScriptModule["kind"];
  text: string;
}

export interface ScriptModuleEvidenceItem extends ScriptRagCandidate {
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  reasons: string[];
}

export interface ScriptModuleEvidencePack {
  moduleId: string;
  moduleLabel: string;
  moduleKind: ScriptModule["kind"];
  query: string;
  items: ScriptModuleEvidenceItem[];
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "how", "in", "into", "is", "it", "of", "on", "or", "our", "that",
  "the", "their", "this", "to", "use", "with", "your",
]);

const KIND_TERMS: Record<ScriptModule["kind"], string[]> = {
  hook: ["hook", "attention", "desire", "dream outcome", "customer language", "pattern interrupt"],
  problem: ["problem", "pain", "frustration", "objection", "struggle", "customer language"],
  agitation: ["pain", "consequence", "frustration", "emotion", "daily life", "objection"],
  solution: ["solution", "mechanism", "product benefit", "how it works", "feature", "demonstration"],
  proof: ["proof", "result", "testimonial", "experience", "evidence", "social proof", "demonstration"],
  offer: ["offer", "price", "value", "options", "bundle", "guarantee", "objection"],
  cta: ["call to action", "next step", "offer", "buying context", "low pressure", "options"],
  custom: ["creative strategy", "customer language", "product", "evidence"],
};

const KIND_SOURCE_AFFINITY: Record<ScriptModule["kind"], Partial<Record<ScriptEvidenceSource, number>>> = {
  hook: { verbatim: 1, winning_ad: 0.95, avatar: 0.8, teardown: 0.7 },
  problem: { verbatim: 1, avatar: 0.95, pipeline: 0.7, teardown: 0.65 },
  agitation: { verbatim: 1, avatar: 0.95, pipeline: 0.7, teardown: 0.65 },
  solution: { product: 1, teardown: 0.85, pipeline: 0.75, knowledge: 0.65 },
  proof: { verbatim: 1, winning_ad: 0.9, product: 0.75, teardown: 0.7 },
  offer: { product: 1, knowledge: 0.65, principle: 0.6, teardown: 0.55 },
  cta: { product: 0.9, principle: 0.8, winning_ad: 0.7, teardown: 0.65 },
  custom: { knowledge: 0.7, principle: 0.7, product: 0.7, verbatim: 0.7 },
};

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function terms(value: string): string[] {
  return clean(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

export function buildScriptModuleQuery(input: {
  module: ScriptModule;
  scaffold: ScriptDocument;
  idea: string;
}): ScriptModuleRetrievalQuery {
  const { module, scaffold } = input;
  const parts = [
    `Write the ${module.label} ${module.kind} module.`,
    KIND_TERMS[module.kind].join(", "),
    `Product: ${scaffold.product.name}.`,
    `Angle: ${scaffold.angle.name}.`,
    scaffold.avatar ? `Avatar: ${scaffold.avatar.name}.` : "",
    input.idea ? `Core idea: ${input.idea}.` : "",
    module.visualDirection ? `Module purpose: ${module.visualDirection}.` : "",
  ];
  return {
    moduleId: module.id,
    moduleKind: module.kind,
    text: parts.filter(Boolean).map(clean).join(" "),
  };
}

function lexicalSimilarity(query: string, candidate: ScriptRagCandidate): number {
  const queryTerms = new Set(terms(query));
  const candidateTerms = new Set(terms(`${candidate.category} ${candidate.title} ${candidate.text}`));
  if (!queryTerms.size || !candidateTerms.size) return 0;
  let matches = 0;
  for (const term of queryTerms) if (candidateTerms.has(term)) matches += 1;
  return matches / Math.sqrt(queryTerms.size * candidateTerms.size);
}

function rankMap(scores: number[]): number[] {
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);
  const ranks = new Array<number>(scores.length);
  order.forEach((item, index) => { ranks[item.index] = index + 1; });
  return ranks;
}

function normalizedRrf(rank: number): number {
  return 61 / (60 + rank);
}

function normalizeText(value: string): string {
  return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

export function rankScriptCandidates(input: {
  query: ScriptModuleRetrievalQuery;
  candidates: ScriptRagCandidate[];
  semanticScores?: Array<number | null>;
  topK?: number;
}): ScriptModuleEvidenceItem[] {
  const { query, candidates } = input;
  if (!candidates.length) return [];
  const topK = Math.max(1, input.topK ?? 6);
  const lexicalScores = candidates.map((candidate) => lexicalSimilarity(query.text, candidate));
  const lexicalRanks = rankMap(lexicalScores);
  const hasSemantic = input.semanticScores?.some((score) => score != null) ?? false;
  const semanticScores = candidates.map((_, index) => input.semanticScores?.[index] ?? null);
  const semanticRanks = hasSemantic
    ? rankMap(semanticScores.map((score) => score ?? -1))
    : lexicalRanks;

  const scored = candidates.map((candidate, index): ScriptModuleEvidenceItem => {
    const lexical = lexicalScores[index] ?? 0;
    const semantic = semanticScores[index] ?? null;
    const lexicalRank = lexicalRanks[index] ?? candidates.length;
    const semanticRank = semanticRanks[index] ?? candidates.length;
    const hybrid = hasSemantic
      ? (0.6 * normalizedRrf(semanticRank)) + (0.4 * normalizedRrf(lexicalRank))
      : normalizedRrf(lexicalRank);
    const affinity = KIND_SOURCE_AFFINITY[query.moduleKind][candidate.source] ?? 0.35;
    const verifiedBoost = candidate.verified ? 0.08 : 0;
    const categoryMatch = KIND_TERMS[query.moduleKind].some((term) => candidate.category.toLocaleLowerCase().includes(term)) ? 0.06 : 0;
    const reasons = [
      hasSemantic ? "hybrid semantic + keyword match" : "keyword match (semantic fallback unavailable)",
      affinity >= 0.8 ? `${candidate.source} is strong evidence for ${query.moduleKind}` : "",
      candidate.verified ? "verified source" : "",
      categoryMatch ? "module-category match" : "",
    ].filter(Boolean);
    return {
      ...candidate,
      lexicalScore: Number(lexical.toFixed(4)),
      semanticScore: semantic == null ? null : Number(semantic.toFixed(4)),
      score: Number((hybrid + (0.18 * affinity) + verifiedBoost + categoryMatch).toFixed(4)),
      reasons,
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const selected: ScriptModuleEvidenceItem[] = [];
  const selectedText = new Set<string>();
  const sourceCounts = new Map<ScriptEvidenceSource, number>();
  for (const item of scored) {
    if (selected.length >= topK) break;
    const textKey = normalizeText(item.text);
    if (!textKey || selectedText.has(textKey)) continue;
    const sameSourceCount = sourceCounts.get(item.source) ?? 0;
    if (sameSourceCount >= 2 && scored.some((other) => !selectedText.has(normalizeText(other.text)) && (sourceCounts.get(other.source) ?? 0) < 2)) {
      continue;
    }
    selected.push(item);
    selectedText.add(textKey);
    sourceCounts.set(item.source, sameSourceCount + 1);
  }
  return selected;
}

export function retrievalMetrics(input: {
  rankedIds: string[];
  relevantIds: Set<string>;
  k?: number;
}): { precisionAtK: number; recallAtK: number; reciprocalRank: number; ndcgAtK: number } {
  const k = Math.max(1, input.k ?? 5);
  const ranked = input.rankedIds.slice(0, k);
  const hits = ranked.filter((id) => input.relevantIds.has(id)).length;
  const firstRelevantIndex = ranked.findIndex((id) => input.relevantIds.has(id));
  const dcg = ranked.reduce((sum, id, index) => sum + (input.relevantIds.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const idealHits = Math.min(input.relevantIds.size, k);
  const idcg = Array.from({ length: idealHits }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return {
    precisionAtK: hits / k,
    recallAtK: input.relevantIds.size ? hits / input.relevantIds.size : 1,
    reciprocalRank: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    ndcgAtK: idcg ? dcg / idcg : 1,
  };
}
