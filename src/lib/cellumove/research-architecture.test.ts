import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeResearchUrl,
  classifyResearchSource,
  evaluateResearchQuality,
  reciprocalRankFusion,
} from "./research-evidence";
import { evaluateRetrieval } from "./research-evaluation";

test("canonicalizes tracking URLs and classifies source types", () => {
  assert.equal(canonicalizeResearchUrl("https://www.reddit.com/r/test/?utm_source=x#reply"), "https://reddit.com/r/test");
  assert.equal(classifyResearchSource("https://reddit.com/r/test/comments/1"), "real_people");
  assert.equal(classifyResearchSource("https://facebook.com/ads/library/?id=1"), "real_ad");
});

test("quality gate rejects source-poor drafts", () => {
  const report = evaluateResearchQuality({
    type: "sub_avatar",
    sources: [{ url: "https://reddit.com/r/a", ok: true }],
    evidence: [{ category: "pain", type: "verbatim", text: "I have tried everything for this problem", sourceUrl: "https://reddit.com/r/a", verificationStatus: "verified" }],
  });
  assert.equal(report.status, "reject");
  assert.ok(report.blockers.some((item) => item.includes("3 cited")));
});

test("quality gate passes a diverse, fully verified evidence set", () => {
  const sources = [
    { url: "https://reddit.com/r/a/comments/1", ok: true },
    { url: "https://mumsnet.com/talk/a/2", ok: true },
    { url: "https://quora.com/answer/3", ok: true },
  ];
  const evidence = sources.flatMap((source, index) => [
    { category: "pain", type: "verbatim" as const, text: `This is a sufficiently specific customer quote number ${index}`, sourceUrl: source.url, verificationStatus: "verified" as const },
    { category: "trigger", type: "claim" as const, text: `Recurring pattern ${index}`, sourceUrl: source.url, verificationStatus: "source_checked" as const },
  ]);
  const report = evaluateResearchQuality({ type: "sub_avatar", sources, evidence });
  assert.equal(report.status, "pass");
  assert.ok(report.score >= 80);
});

test("reciprocal rank fusion rewards evidence found by both retrievers", () => {
  const result = reciprocalRankFusion([["a", "b"], ["b", "c"]], [0.6, 0.4]);
  assert.equal(result[0]?.id, "b");
});

test("retrieval evaluation computes precision, recall, MRR, and NDCG", () => {
  const metrics = evaluateRetrieval({
    retrievedIds: ["noise", "best", "good"],
    relevance: { best: 3, good: 1, missing: 2 },
    k: 3,
  });
  assert.equal(metrics.precisionAtK, 2 / 3);
  assert.equal(metrics.recallAtK, 2 / 3);
  assert.equal(metrics.mrr, 0.5);
  assert.ok(metrics.ndcgAtK > 0 && metrics.ndcgAtK < 1);
});

