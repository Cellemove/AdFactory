import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHookScores,
  GeneratedHookScoresSchema,
  parseGeneratedHookScores,
} from "./script-hook-rank";
import { createInitialScriptDocument, parseScriptDocument, sortHooksByScore, bestHook } from "./script-studio";

test("applyHookScores merges by index, ignores out-of-range and duplicate indices", () => {
  const hooks: Array<{ id: string; text: string; score?: number; scoreReason?: string }> = [
    { id: "a", text: "one" },
    { id: "b", text: "two" },
    { id: "c", text: "three" },
  ];
  const merged = applyHookScores(hooks, [
    { index: 1, score: 88.6, reason: "strong accusation" },
    { index: 1, score: 10, reason: "duplicate — ignored" },
    { index: 99, score: 50, reason: "out of range" },
  ]);
  assert.equal(merged[0]!.score, undefined);
  assert.equal(merged[1]!.score, 89);
  assert.equal(merged[1]!.scoreReason, "strong accusation");
  assert.equal(merged[2]!.score, undefined);
  // Input untouched
  assert.equal((hooks[1] as { score?: number }).score, undefined);
});

test("sortHooksByScore puts scored first desc, unscored keep relative order", () => {
  const sorted = sortHooksByScore([
    { id: "u1" },
    { id: "s1", score: 70 },
    { id: "u2" },
    { id: "s2", score: 92 },
  ]);
  assert.deepEqual(sorted.map((hook) => hook.id), ["s2", "s1", "u1", "u2"]);
});

test("bestHook prefers top score, else selected, else first", () => {
  const base = createInitialScriptDocument({
    title: "T",
    product: { id: "p", name: "P", code: "V1" },
    avatar: null,
    angle: { id: "a", name: "Angle" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "Idea goes here.",
    teardown: null,
  });
  const document = parseScriptDocument({
    ...base,
    hookAlternatives: [
      { id: "h1", text: "one" },
      { id: "h2", text: "two", score: 90 },
      { id: "h3", text: "three", score: 40 },
    ],
    selectedHookId: "h3",
  });
  assert.equal(bestHook(document)?.id, "h2");
  const unscored = parseScriptDocument({
    ...document,
    hookAlternatives: document.hookAlternatives.map(({ id, text }) => ({ id, text })),
  });
  assert.equal(bestHook(unscored)?.id, "h3"); // falls back to selected
});

test("schema rejects out-of-range scores and missing reasons; parse round-trips", () => {
  assert.deepEqual(
    parseGeneratedHookScores({ scores: [{ index: 0, score: 55, reason: "ok" }] }),
    [{ index: 0, score: 55, reason: "ok" }],
  );
  assert.throws(() => parseGeneratedHookScores({ scores: [{ index: 0, score: 101, reason: "x" }] }));
  assert.throws(() => parseGeneratedHookScores({ scores: [{ index: 0, score: 50 }] }));
  assert.equal(GeneratedHookScoresSchema.safeParse({ scores: [] }).success, false);
});

test("documents without hook scores still parse (backward compatibility)", () => {
  const base = createInitialScriptDocument({
    title: "T",
    product: { id: "p", name: "P", code: "V1" },
    avatar: null,
    angle: { id: "a", name: "Angle" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "Idea goes here.",
    teardown: null,
  });
  const parsed = parseScriptDocument({
    ...base,
    hookAlternatives: [{ id: "h1", text: "plain old hook" }],
  });
  assert.equal(parsed.hookAlternatives[0]!.score, undefined);
});
