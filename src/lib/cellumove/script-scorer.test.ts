import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptDocument } from "./script-studio";
import {
  scoreFactVerification,
  judgeScoreImprovement,
  scoreObserverFlags,
  stabilizedFactScore,
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
  schemaVersion: 2,
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
  workflow: {
    brief: { conceptLabel: "Test", hookDirection: null, marketCode: "PH", heatLevel: 3, funnelStage: "MOFU", voicePlan: "Standard UGC", offerId: null, referenceMode: "structure_beats", playbookVersionId: "playbook-1" },
    playbook: { id: "playbook-1", version: "v1", title: "Test playbook", sourceHash: "hash", promptInstructions: "Test instructions", config: {} },
    evidence: { verbatimIds: [], factIds: [], offerIds: [], referenceIds: [] },
    generatedAt: null,
  },
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

test("derives taxonomy layers from codes instead of trusting extractor layers", () => {
  const wrongLayer = { lines: analysis.lines.map((line, index) => index === 0 ? { ...line, layer: "M" as const } : line) };
  const result = validateAnalyzedScript({
    document,
    analysis: wrongLayer,
    allowedCodes: new Map([["H_OPENING", "H"], ["M_MECHANISM", "M"], ["O_CTA", "O"]] as const),
  });
  assert.equal(result.lines[0]?.layer, "H");
});

test("normalizes OTHER from an offer-layer hint for an ambiguous CTA sentence", () => {
  const ctaDocument: ScriptDocument = {
    ...document,
    modules: [{ ...document.modules[2]!, spokenText: "So I tried them, and wow." }],
  };
  const result = validateAnalyzedScript({
    document: ctaDocument,
    analysis: {
      lines: [{
        scriptModuleId: "m3",
        lineIndex: 0,
        text: "So I tried them, and wow.",
        code: "OTHER",
        layer: "O",
        otherExplanation: "A reaction that does not fit the closed taxonomy.",
        concreteSpans: [],
        factualAssertions: [],
      }],
    },
    allowedCodes: new Map([["OTHER", "OTHER"]] as const),
  });
  assert.equal(result.lines[0]?.layer, "OTHER");
});

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

test("scores structural coverage, order, and durations against five gold ads", () => {
  const result = scoreStructuralFit({ document, analysis, goldAds, angleSlug: "daily-relief", format: "UGC" });
  assert.equal(result.status, "scored");
  assert.equal(result.score, 100);
});

test("Structure falls back to Corpus Miner winners: same format first, then every winner, gold ads still preferred", () => {
  const winner = (id: string, format: string): GoldAdInput => ({ ...goldAds[0]!, id, angleSlug: "", format });
  const sameFormat = Array.from({ length: 5 }, (_, index) => winner(`ugc-${index}`, "UGC"));
  const otherFormat = Array.from({ length: 6 }, (_, index) => winner(`vo-${index}`, "Voiceover"));
  const byFormat = scoreStructuralFit({ document, analysis, goldAds: [], corpusAds: [...sameFormat, ...otherFormat], angleSlug: "new-angle", format: "UGC" });
  assert.equal(byFormat.status, "scored");
  assert.equal(byFormat.metrics.cohortType, "corpus_format");
  assert.equal(byFormat.metrics.cohortSize, 5);
  const anyFormat = scoreStructuralFit({ document, analysis, goldAds: [], corpusAds: otherFormat, angleSlug: "new-angle", format: "UGC" });
  assert.equal(anyFormat.metrics.cohortType, "corpus_all");
  assert.match(anyFormat.summary, /Corpus Miner/);
  assert.equal(scoreStructuralFit({ document, analysis, goldAds, corpusAds: otherFormat, angleSlug: "daily-relief", format: "UGC" }).metrics.cohortType, "angle_and_format");
  assert.equal(scoreStructuralFit({ document, analysis, goldAds: [], corpusAds: otherFormat.slice(0, 4), angleSlug: "new-angle", format: "UGC" }).status, "insufficient_evidence");
});

test("an AI edit is offered only when scores really rise and Facts never fall", () => {
  const before = { structural_fit: 70, verbatim_grounding: 27, specificity: 69, fact_verification: 25, observer_flags: null };
  assert.equal(judgeScoreImprovement(before, { ...before, verbatim_grounding: 45, specificity: 75 }).accept, true);
  assert.equal(judgeScoreImprovement(before, { ...before, verbatim_grounding: 28 }).accept, false, "a 1-point gain is noise");
  assert.match(judgeScoreImprovement(before, { ...before, verbatim_grounding: 60, fact_verification: 24 }).reasons.join(" "), /fact_verification fell/);
  assert.match(judgeScoreImprovement(before, { ...before, verbatim_grounding: 60, structural_fit: 60 }).reasons.join(" "), /structural_fit fell/);
  assert.equal(judgeScoreImprovement(before, { ...before, verbatim_grounding: 60, structural_fit: 66 }).accept, true, "a small dip is fine when the gain dwarfs it");
  assert.match(judgeScoreImprovement(before, { ...before, verbatim_grounding: 35, structural_fit: 66 }).reasons.join(" "), /does not clearly outweigh/, "+8 for -4 is a trade, not an improvement");
  // The real case that was wrongly refused: +16 Grounding, +45 Specificity, +7 Facts, -4 Structure.
  assert.equal(judgeScoreImprovement({ structural_fit: 75, verbatim_grounding: 9, specificity: 55, fact_verification: 33 }, { structural_fit: 71, verbatim_grounding: 25, specificity: 100, fact_verification: 40 }).accept, true);
  assert.match(judgeScoreImprovement(before, { ...before, verbatim_grounding: null }).reasons.join(" "), /no longer be scored/);
});

test("an unchanged claim keeps its original Facts verdict; only new wording is judged fresh", () => {
  const original = [{ scriptQuote: "go all the way up to 7XL", severity: "info" }, { scriptQuote: "boosts circulation by thirty percent", severity: "warning" }];
  // Same two sentences, but this run's paraphrase flipped the first one: noise, not an edit.
  assert.equal(stabilizedFactScore(original, [{ scriptQuote: "go all the way up to 7XL", severity: "warning" }, { scriptQuote: "boosts circulation by thirty percent", severity: "warning" }]), 50);
  // A reworded claim is judged on its own merits, in both directions.
  assert.equal(stabilizedFactScore(original, [{ scriptQuote: "go all the way up to 7XL", severity: "info" }, { scriptQuote: "is designed to stay in contact with the legs", severity: "info" }]), 100);
  assert.equal(stabilizedFactScore(original, [{ scriptQuote: "sizes run up to 9XL", severity: "critical" }, { scriptQuote: "boosts circulation by thirty percent", severity: "warning" }]), 0);
  assert.equal(stabilizedFactScore(original, []), null);
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

test("fact verification recognizes safe catalog paraphrases without approving unrelated claims", () => {
  const paraphrases: AnalyzedScript = { lines: [{
    ...analysis.lines[1]!,
    text: "They come in many different colors and go up to size 7XL. Its 3D knit provides gentle, targeted support.",
    factualAssertions: [
      { quote: "They come in many different colors and go up to size 7XL", normalizedClaim: "They come in many different colors and go up to size 7XL", claimType: "product" },
      { quote: "Its 3D knit provides gentle, targeted support", normalizedClaim: "Its 3D knit provides gentle targeted support", claimType: "mechanism" },
      { quote: "It cures lipedema", normalizedClaim: "It cures lipedema", claimType: "outcome" },
    ],
  }] };
  const result = scoreFactVerification({
    analysis: paraphrases,
    evidence: [
      { id: "colors", type: "brand_fact", text: "This product is available in 12 listed colors and sizes ranging from S through 7XL." },
      { id: "support", type: "brand_fact", text: "Cellumove describes its 3D technology as combining textured fabric, targeted compression, and sculpting support." },
    ],
  });
  assert.equal(result.score, 66.67);
  assert.equal(result.findings.filter((finding) => finding.severity === "info").length, 2);
  assert.equal(result.findings.at(-1)?.severity, "warning");
});

test("observer flags remain non-scoring", () => {
  const flagged: AnalyzedScript = { lines: [{ ...analysis.lines[1]!, text: "Clinically proven cure [citation]." }] };
  const result = scoreObserverFlags({ document, analysis: flagged });
  assert.equal(result.score, null);
  assert.ok(result.findings.length >= 2);
});
