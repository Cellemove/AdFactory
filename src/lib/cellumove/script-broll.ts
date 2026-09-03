import type { ScriptDocument, ScriptModule } from "@/lib/cellumove/script-studio";

export const SCRIPT_BROLL_MAX_PER_MODULE = 2;
export const SCRIPT_BROLL_RECENT_PROJECT_WINDOW = 10;
export const SCRIPT_BROLL_SEMANTIC_THRESHOLD = 0.58;
export const SCRIPT_BROLL_KEYWORD_THRESHOLD = 0.12;

export interface ScriptBrollCandidate {
  id: string;
  name: string;
  url: string | null;
  folderPath: string | null;
  description: string;
  tags: string;
}

export interface ScriptBrollQuery {
  moduleId: string;
  text: string;
}

export interface RankedScriptBroll {
  clip: ScriptBrollCandidate;
  relevance: number;
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  recentSuggestionCount: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "their", "this", "to", "with", "you", "your", "show", "shot", "video", "module",
]);

const MODULE_VISUAL_TERMS: Record<ScriptModule["kind"], string[]> = {
  hook: ["pattern interrupt", "reaction", "close-up", "opening action"],
  problem: ["frustration", "struggle", "before", "daily life"],
  agitation: ["emotion", "discomfort", "frustration", "daily impact"],
  solution: ["product demonstration", "putting on", "fabric", "feature", "how it works"],
  proof: ["demonstration", "texture", "fit", "before after", "result", "close-up"],
  offer: ["product options", "colors", "package", "bundle"],
  cta: ["product package", "holding product", "shopping", "final product shot"],
  custom: ["product", "lifestyle", "demonstration", "reaction"],
};

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function terms(value: string): string[] {
  return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

export function buildScriptBrollQuery(input: { document: ScriptDocument; module: ScriptModule; idea: string }): ScriptBrollQuery {
  const { document } = input;
  const beat = input.module;
  return {
    moduleId: beat.id,
    text: clean([
      `Ad idea: ${input.idea}.`,
      `Product: ${document.product.name}.`,
      `Avatar: ${document.avatar?.name ?? "general product customer"}.`,
      `Angle: ${document.angle.name}.`,
      `Beat: ${beat.label} (${beat.kind}).`,
      `Visual needs: ${MODULE_VISUAL_TERMS[beat.kind].join(", ")}.`,
      `Spoken copy: ${beat.spokenText}.`,
      `On-screen text: ${beat.onScreenText}.`,
      `Visual direction: ${beat.visualDirection}.`,
    ].join(" ")),
  };
}

export function brollCandidateText(candidate: ScriptBrollCandidate): string {
  return clean(`${candidate.description}\n${candidate.tags}\nFolder: ${candidate.folderPath ?? ""}`);
}

export function scriptBrollLexicalScore(query: string, candidate: ScriptBrollCandidate): number {
  const queryTerms = new Set(terms(query));
  const candidateTerms = new Set(terms(brollCandidateText(candidate)));
  if (!queryTerms.size || !candidateTerms.size) return 0;
  let matches = 0;
  for (const term of queryTerms) if (candidateTerms.has(term)) matches += 1;
  return matches / Math.sqrt(queryTerms.size * candidateTerms.size);
}

export function preselectScriptBrollCandidates(input: {
  queries: ScriptBrollQuery[];
  candidates: ScriptBrollCandidate[];
  perModule?: number;
}): ScriptBrollCandidate[] {
  const selected = new Map<string, ScriptBrollCandidate>();
  const perModule = Math.max(10, input.perModule ?? 50);
  for (const query of input.queries) {
    input.candidates
      .map((candidate) => ({ candidate, score: scriptBrollLexicalScore(query.text, candidate) }))
      .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
      .slice(0, perModule)
      .forEach(({ candidate }) => selected.set(candidate.id, candidate));
  }
  return [...selected.values()];
}

export function rankScriptBrollCandidates(input: {
  query: ScriptBrollQuery;
  candidates: ScriptBrollCandidate[];
  semanticScores?: Array<number | null>;
  recentSuggestionCounts: Map<string, number>;
  excludedClipIds: Set<string>;
  limit?: number;
}): RankedScriptBroll[] {
  const semanticReady = input.semanticScores?.some((score) => score != null) ?? false;
  return input.candidates
    .map((clip, index): RankedScriptBroll => {
      const lexicalScore = scriptBrollLexicalScore(input.query.text, clip);
      const semanticScore = input.semanticScores?.[index] ?? null;
      const relevance = semanticReady && semanticScore != null
        ? (0.82 * semanticScore) + (0.18 * lexicalScore)
        : lexicalScore;
      const recentSuggestionCount = input.recentSuggestionCounts.get(clip.id) ?? 0;
      const reusePenalty = Math.min(0.2, recentSuggestionCount * 0.04);
      return { clip, relevance, score: relevance - reusePenalty, lexicalScore, semanticScore, recentSuggestionCount };
    })
    .filter((item) => !input.excludedClipIds.has(item.clip.id))
    .filter((item) => item.relevance >= (semanticReady ? SCRIPT_BROLL_SEMANTIC_THRESHOLD : SCRIPT_BROLL_KEYWORD_THRESHOLD))
    .sort((a, b) => b.score - a.score || b.relevance - a.relevance || a.clip.id.localeCompare(b.clip.id))
    .slice(0, input.limit ?? SCRIPT_BROLL_MAX_PER_MODULE);
}
