import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL, MODEL_BY_FEATURE, modelFor } from "./llm";

test("modelFor: env override beats the promoted table, which beats the default", () => {
  assert.equal(modelFor("never_promoted_feature"), DEFAULT_MODEL);
  MODEL_BY_FEATURE.bench_probe = "gemini-2.5-flash";
  assert.equal(modelFor("bench_probe"), "gemini-2.5-flash");
  process.env.AI_MODEL_BENCH_PROBE = " gemini-2.5-flash-lite ";
  assert.equal(modelFor("bench_probe"), "gemini-2.5-flash-lite");
  delete process.env.AI_MODEL_BENCH_PROBE;
  delete MODEL_BY_FEATURE.bench_probe;
  assert.equal(modelFor("bench_probe"), DEFAULT_MODEL);
});
