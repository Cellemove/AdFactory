export interface RetrievalMetrics {
  precisionAtK: number;
  recallAtK: number;
  hitRate: number;
  mrr: number;
  ndcgAtK: number;
}

export function evaluateRetrieval(input: {
  retrievedIds: string[];
  relevance: Record<string, number>;
  k: number;
}): RetrievalMetrics {
  const k = Math.max(1, input.k);
  const retrieved = input.retrievedIds.slice(0, k);
  const relevantIds = new Set(Object.entries(input.relevance).filter(([, score]) => score > 0).map(([id]) => id));
  const relevantRetrieved = retrieved.filter((id) => relevantIds.has(id)).length;
  const firstRelevant = retrieved.findIndex((id) => relevantIds.has(id));
  const gains = retrieved.map((id) => input.relevance[id] ?? 0);
  const ideal = Object.values(input.relevance).sort((a, b) => b - a).slice(0, k);
  const dcg = discountedCumulativeGain(gains);
  const idealDcg = discountedCumulativeGain(ideal);
  return {
    precisionAtK: relevantRetrieved / k,
    recallAtK: relevantIds.size ? relevantRetrieved / relevantIds.size : 0,
    hitRate: relevantRetrieved > 0 ? 1 : 0,
    mrr: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    ndcgAtK: idealDcg ? dcg / idealDcg : 0,
  };
}

function discountedCumulativeGain(scores: number[]): number {
  return scores.reduce((sum, relevance, index) => sum + relevance / Math.log2(index + 2), 0);
}

export const RESEARCH_RETRIEVAL_TARGETS = {
  precisionAt5: 0.7,
  recallAt5: 0.8,
  ndcgAt5: 0.7,
  citationValidity: 0.95,
  verbatimExactness: 1,
} as const;

