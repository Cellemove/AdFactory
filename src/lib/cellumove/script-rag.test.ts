import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScriptModuleQuery,
  rankScriptCandidates,
  retrievalMetrics,
  type ScriptRagCandidate,
} from "./script-rag";
import { createInitialScriptDocument } from "./script-studio";

const scaffold = createInitialScriptDocument({
  title: "Vacation confidence",
  product: { id: "product-1", name: "3D Leggings", code: "V1" },
  avatar: { id: "avatar-1", name: "Pre-vacation confidence seeker" },
  angle: { id: "angle-1", name: "Smoother silhouette" },
  framework: null,
  format: "UGC",
  targetDurationSec: 30,
  idea: "Feel confident packing for a holiday",
  teardown: null,
});

const candidates: ScriptRagCandidate[] = [
  {
    id: "pain-1",
    source: "verbatim",
    category: "pain frustration",
    text: "I avoid packing fitted outfits because I feel self-conscious about how my clothes sit.",
    title: "Verified customer comment",
    url: "https://example.com/pain",
    verified: true,
  },
  {
    id: "proof-1",
    source: "verbatim",
    category: "proof result experience",
    text: "The fabric felt supportive and my dress looked smoother over it.",
    title: "Verified customer result",
    url: "https://example.com/proof",
    verified: true,
  },
  {
    id: "product-1",
    source: "product",
    category: "product feature mechanism",
    text: "Compression-knit leggings with a high-rise waistband and multiple colour options.",
    title: "Shopify product facts",
    url: null,
    verified: true,
  },
  {
    id: "generic-1",
    source: "knowledge",
    category: "writing",
    text: "Use short sentences and clear transitions in every advertisement.",
    title: "Writing principle",
    url: null,
    verified: true,
  },
];

test("module queries change with the job of each module", () => {
  const hook = buildScriptModuleQuery({ module: scaffold.modules[0]!, scaffold, idea: "Holiday confidence" });
  const proofModule = { ...scaffold.modules[2]!, kind: "proof" as const, label: "Proof" };
  const proof = buildScriptModuleQuery({ module: proofModule, scaffold, idea: "Holiday confidence" });
  assert.match(hook.text, /attention|dream outcome/);
  assert.match(proof.text, /proof|evidence/);
  assert.notEqual(hook.text, proof.text);
});

test("deterministic reranking gives problem and proof modules different evidence", () => {
  const problemQuery = buildScriptModuleQuery({ module: scaffold.modules[1]!, scaffold, idea: "Holiday confidence" });
  const proofModule = { ...scaffold.modules[2]!, kind: "proof" as const, label: "Proof" };
  const proofQuery = buildScriptModuleQuery({ module: proofModule, scaffold, idea: "Holiday confidence" });
  const problem = rankScriptCandidates({ query: problemQuery, candidates, topK: 3 });
  const proof = rankScriptCandidates({ query: proofQuery, candidates, topK: 3 });
  assert.equal(problem[0]?.id, "pain-1");
  assert.equal(proof[0]?.id, "proof-1");
  assert.ok(problem.every((item) => item.reasons.length > 0));
});

test("hybrid scoring accepts semantic scores and preserves source diversity", () => {
  const proofModule = { ...scaffold.modules[2]!, kind: "proof" as const, label: "Proof" };
  const query = buildScriptModuleQuery({ module: proofModule, scaffold, idea: "Holiday confidence" });
  const ranked = rankScriptCandidates({ query, candidates, semanticScores: [0.2, 0.94, 0.7, 0.1], topK: 4 });
  assert.equal(ranked[0]?.id, "proof-1");
  assert.ok(new Set(ranked.map((item) => item.source)).size >= 2);
  assert.equal(ranked[0]?.semanticScore, 0.94);
});

test("retrieval metrics expose the quality gate inputs", () => {
  const metrics = retrievalMetrics({ rankedIds: ["proof-1", "generic-1", "product-1"], relevantIds: new Set(["proof-1", "product-1"]), k: 3 });
  assert.equal(metrics.precisionAtK, 2 / 3);
  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.reciprocalRank, 1);
  assert.ok(metrics.ndcgAtK > 0.9);
});
