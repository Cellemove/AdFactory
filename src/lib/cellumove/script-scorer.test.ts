import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptDocument } from "./script-studio";
import {
  scoreFactVerification,
  scoreObserverFlags,
  scoreSpecificity,
  scoreStructuralFit,
  scoreVerbatimGrounding,
  scorerInputHash,
  scriptSourceLines,
  validateAnalyzedScript,
  type AnalyzedScript,
  type GoldAdInput,
} from "./script-scorer";

const document: ScriptDocument = {
  schemaVersion: 1,
  title: "Test script",
  product: { id: "product-1", name: "Move", code: "V1" },
  avatar: { id: "avatar-1", name: "Busy parent" },
  angle: { id: "angle-1", name: "Daily relief" },
  framework: null,
  format: "UGC",
  targetDurationSec: 15,
  sourceRefs: [],
  hookAlternatives: [],
  selectedHookId: null,
  modules: [
    { id: "m1", kind: "hook", label: "Hook", durationSec: 5, spokenText: "At 6 PM, my knees felt locked.", onScreenText: "", visualDirection: "", brollRefs: [], locked: false, claimFlags: [] },
    { id: "m2", kind: "solution", label: "Solution", durationSec: 5, spokenText: "Move supports daily mobility.", onScreenText: "", visualDirection: "", brollRefs: [], locked: false, claimFlags: [] },
    { id: "m3", kind: "cta", label: "CTA", durationSec: 5, spokenText: "Try Move today.", onScreenText: "", visualDirection: "", brollRefs: [], locked: false, claimFlags: [] },
  ],
};

const analysis: AnalyzedScript = {
  lines: [
    { scriptModuleId: "m1", lineIndex: 0, text: "At 6 PM, my knees felt locked.", layer: "H", code: "H_OPENING", concreteSpans: [{ text: "6 PM", kind: "time" }], factualAssertions: [] },
    { scriptModuleId: "m2", lineIndex: 0, text: "Move supports daily mobility.", layer: "M", code: "M_MECHANISM", concreteSpans: [{ text: "Move", kind: "named_object" }], factualAssertions: [{ quote: "Move supports daily mobility", normalizedClaim: "Move supports daily mobility", claimType: "product" }] },
    { scriptModuleId: "m3", lineIndex: 0, text: "Try Move today.", layer: "O", code: "O_CTA", concreteSpans: [{ text: "Try Move", kind: "action" }], factualAssertions: [] },
  ],
};

test("builds stable immutable input hashes", () => {
  const first = scorerInputHash({ document, marketCode: "PH", productId: "product-1", angleId: "angle-1", subAvatarId: "avatar-1" });
  const second = scorerInputHash({ document, marketCode: "PH", productId: "product-1", angleId: "angle-1", subAvatarId: "avatar-1" });
  assert.equal(first, second);
  assert.notEqual(first, scorerInputHash({ document, marketCode: "US", productId: "product-1", angleId: "angle-1", subAvatarId: "avatar-1" }));
});

test("validates exact lines, quotes, and taxonomy codes", () => {
  assert.equal(scriptSourceLines(document).length, 3);
  const codes = new Map([["H_OPENING", "H"], ["M_MECHANISM", "M"], ["O_CTA", "O"]] as const);
  assert.equal(validateAnalyzedScript({ document, analysis, allowedCodes: codes }).lines.length, 3);
  assert.throws(() => validateAnalyzedScript({
    document,
    analysis: { lines: analysis.lines.map((line, index) => index === 0 ? { ...line, text: "Changed" } : line) },
    allowedCodes: codes,
  }), /changed the source text/);
});

test("rejects taxonomy codes paired with the wrong layer", () => {
  const wrongLayer = { lines: analysis.lines.map((line, index) => index === 0 ? { ...line, layer: "M" as const } : line) };
  assert.throws(() => validateAnalyzedScript({
    document,
    analysis: wrongLayer,
    allowedCodes: new Map([["H_OPENING", "H"], ["M_MECHANISM", "M"], ["O_CTA", "O"]] as const),
  }), /expected H/);
});

test("scores structural coverage, order, and durations against five gold ads", () => {
  const goldAds: GoldAdInput[] = Array.from({ length: 5 }, (_, index) => ({
    id: `gold-${index}`,
    angleSlug: "daily-relief",
    format: "UGC",
    beats: [
      { code: "H_OPENING", layer: "H", orderIndex: 0, startSec: 0, endSec: 5 },
      { code: "M_MECHANISM", layer: "M", orderIndex: 1, startSec: 5, endSec: 10 },
      { code: "O_CTA", layer: "O", orderIndex: 2, startSec: 10, endSec: 15 },
    ],
  }));
  const result = scoreStructuralFit({ document, analysis, goldAds, angleSlug: "daily-relief", format: "UGC" });
  assert.equal(result.status, "scored");
  assert.equal(result.score, 100);
});

test("reports unavailable structural and grounding datasets honestly", () => {
  assert.equal(scoreStructuralFit({ document, analysis, goldAds: [], angleSlug: "daily-relief", format: "UGC" }).status, "insufficient_evidence");
  assert.equal(scoreVerbatimGrounding({ matches: [], candidateCount: 9, cohort: "avatar_market" }).status, "insufficient_evidence");
});

test("scores only eligible audience-language grounding lines", () => {
  const result = scoreVerbatimGrounding({
    candidateCount: 10,
    cohort: "avatar_market",
    matches: analysis.lines.map((line) => ({ line, evidenceId: "v1", evidenceQuote: "my knees lock up every night", similarity: line.layer === "H" ? 0.8 : 0.1 })),
  });
  assert.equal(result.score, 100);
  assert.equal(result.metrics.eligibleLines, 1);
});

test("specificity is deterministic and bounded", () => {
  const result = scoreSpecificity(analysis);
  assert.equal(result.status, "scored");
  assert.equal(result.score, 100);
  assert.equal(result.findings.length, 0);
});

test("fact verification distinguishes missing configuration, support, and numeric conflict", () => {
  assert.equal(scoreFactVerification({ analysis, evidence: [] }).status, "not_configured");
  const supported = scoreFactVerification({ analysis, evidence: [{ id: "f1", type: "brand_fact", text: "Move supports daily mobility" }] });
  assert.equal(supported.score, 100);
  const priceAnalysis: AnalyzedScript = { lines: [{ ...analysis.lines[1]!, factualAssertions: [{ quote: "Move supports daily mobility", normalizedClaim: "Move supports daily mobility for $29", claimType: "price" }] }] };
  const conflict = scoreFactVerification({ analysis: priceAnalysis, evidence: [{ id: "o1", type: "product_offer", text: "Move supports daily mobility for $39" }] });
  assert.equal(conflict.findings[0]?.severity, "critical");
});

test("observer flags remain non-scoring", () => {
  const flagged: AnalyzedScript = { lines: [{ ...analysis.lines[1]!, text: "Clinically proven cure [citation]." }] };
  const result = scoreObserverFlags({ document, analysis: flagged });
  assert.equal(result.score, null);
  assert.ok(result.findings.length >= 2);
});
