import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWorkflowScore,
  lexicalLineSimilarity,
  parseWorkflowAuditExtraction,
  selectSpeakingRateBand,
  validateWorkflowFindingQuotes,
  workflowRubricFromConfig,
  workflowGateStatus,
  type WorkflowAuditFinding,
} from "./script-creative-workflow";
import { SCRIPT_STUDIO_PLAYBOOK_FIRST_DRAFT } from "./script-playbook-first-draft";

const finding = (category: WorkflowAuditFinding["category"], pointsDeducted: number): WorkflowAuditFinding => ({
  ruleId: `${category}.test`,
  category,
  severity: "warning",
  scriptModuleId: "module-1",
  lineIndex: 0,
  scriptQuote: "This is exact.",
  message: "Test finding.",
  recommendation: "Fix the test issue.",
  fixEligible: true,
  pointsDeducted,
  metadata: {},
});

test("calculates the 100-point rubric deterministically and caps deductions per category", () => {
  assert.equal(calculateWorkflowScore([]), 100);
  assert.equal(calculateWorkflowScore([finding("hook", 6), finding("mechanism", 4)]), 90);
  assert.equal(calculateWorkflowScore([finding("close", 100), finding("cadence", 100), finding("originality", 100)]), 92);
  assert.equal(workflowGateStatus(85), "pass");
  assert.equal(workflowGateStatus(70), "needs_refinement");
  assert.equal(workflowGateStatus(69), "weak_alignment");
});

test("reads valid versioned weights and rejects malformed totals", () => {
  const valid = Object.fromEntries(["hook", "reframe", "mechanism", "pitch", "engagement", "trust", "close"].map((category) => [category, { weight: category === "hook" ? 20 : ({ reframe: 15, mechanism: 20, pitch: 10, engagement: 15, trust: 12, close: 8 } as Record<string, number>)[category] }]));
  assert.equal(workflowRubricFromConfig({ auditRubric: valid }).hook, 20);
  const invalid = structuredClone(valid);
  invalid.close = { weight: 99 };
  assert.equal(workflowRubricFromConfig({ auditRubric: invalid }).close, 8);
});

test("selects adaptive speaking-rate bands from delivery context", () => {
  assert.deepEqual(selectSpeakingRateBand({ format: "Rapid direct response", voicePlan: "High energy" }), { key: "fast_direct_response", min: 3.3, max: 4 });
  assert.deepEqual(selectSpeakingRateBand({ format: "UGC testimonial", voicePlan: "Calm and reassuring", avatarName: "Women over 60" }), { key: "calm_testimonial", min: 2.3, max: 3 });
  assert.deepEqual(selectSpeakingRateBand({ format: "Sung jingle", voicePlan: "Musical" }), { key: "sung", min: 1.7, max: 1.9 });
  assert.deepEqual(selectSpeakingRateBand({ format: "UGC", voicePlan: "Conversational" }), { key: "standard_ugc", min: 2.8, max: 3.4 });
});

test("rejects audit deductions that do not cite exact script text", () => {
  const modules = [{ id: "module-1", spokenText: "This is exact.", onScreenText: "EXACT", visualDirection: "Open on the product." }];
  assert.doesNotThrow(() => validateWorkflowFindingQuotes([finding("hook", 2)], modules));
  assert.throws(() => validateWorkflowFindingQuotes([{ ...finding("hook", 2), scriptQuote: "Paraphrased text" }], modules), /quote is not exact/);
});

test("historical similarity is warning-grade matching, not identity-only matching", () => {
  assert.equal(lexicalLineSimilarity("My legs feel lighter at the end of the day", "At the end of the day my legs feel lighter"), 1);
  assert.ok(lexicalLineSimilarity("Choose your pair today", "See the available colors") < 0.5);
});

test("repairs Gemini's harmless top-level findings array while keeping strict finding validation", () => {
  assert.deepEqual(parseWorkflowAuditExtraction([finding("hook", 2)]).findings, [finding("hook", 2)]);
  assert.throws(() => parseWorkflowAuditExtraction([{ ...finding("hook", 2), scriptQuote: "" }]), /too_small/);
});

test("first playbook draft keeps a valid rubric and approved-evidence boundary", () => {
  const draft = SCRIPT_STUDIO_PLAYBOOK_FIRST_DRAFT;
  const weights = workflowRubricFromConfig({ ...draft.config });
  assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 100);
  assert.deepEqual(draft.config.claimPolicy.supportSources, ["approved_brand_fact", "applicable_approved_offer"]);
  assert.ok(draft.config.source.excludedAsAuthority.includes("instructions_to_bypass_evidence_or_compliance"));
  assert.equal(draft.config.workflowAudit.separateFromEvidenceScorer, true);
  assert.equal(draft.config.lifecycle.auditIsAdvisory, true);
});
