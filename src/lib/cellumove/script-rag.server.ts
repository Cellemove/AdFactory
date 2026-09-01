import "server-only";

import { cosine, embedTexts } from "@/lib/cellumove/embeddings";
import {
  buildScriptModuleQuery,
  rankScriptCandidates,
  type ScriptModuleEvidencePack,
  type ScriptRagCandidate,
} from "@/lib/cellumove/script-rag";
import type { ScriptDocument } from "@/lib/cellumove/script-studio";

export async function retrieveScriptModuleEvidence(input: {
  scaffold: ScriptDocument;
  idea: string;
  candidates: ScriptRagCandidate[];
  topK?: number;
}): Promise<{ packs: ScriptModuleEvidencePack[]; mode: "hybrid" | "keyword" }> {
  const modules = input.scaffold.modules.filter((module) => !module.locked);
  const queries = modules.map((module) => buildScriptModuleQuery({ module, scaffold: input.scaffold, idea: input.idea }));
  const embeddings = await embedTexts([
    ...queries.map((query) => query.text),
    ...input.candidates.map((candidate) => `${candidate.category}\n${candidate.title}\n${candidate.text}`),
  ]);
  const queryEmbeddings = embeddings?.slice(0, queries.length) ?? [];
  const candidateEmbeddings = embeddings?.slice(queries.length) ?? [];
  const hybridReady = Boolean(
    queries.length
    && input.candidates.length
    && queryEmbeddings.length === queries.length
    && candidateEmbeddings.length === input.candidates.length
    && candidateEmbeddings.every((embedding) => embedding.length > 0),
  );

  const packs = modules.map((module, moduleIndex): ScriptModuleEvidencePack => {
    const query = queries[moduleIndex]!;
    const queryEmbedding = queryEmbeddings[moduleIndex] ?? [];
    const semanticScores = hybridReady
      ? candidateEmbeddings.map((candidateEmbedding) => cosine(queryEmbedding, candidateEmbedding))
      : undefined;
    return {
      moduleId: module.id,
      moduleLabel: module.label,
      moduleKind: module.kind,
      query: query.text,
      items: rankScriptCandidates({
        query,
        candidates: input.candidates,
        semanticScores,
        topK: input.topK ?? 6,
      }),
    };
  });

  return { packs, mode: hybridReady ? "hybrid" : "keyword" };
}
