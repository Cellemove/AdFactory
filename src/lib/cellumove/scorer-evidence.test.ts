import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateScorerEvidenceSchema,
  countAlternativeHooks,
  parseScorerEvidencePayload,
  scorerEvidenceHash,
} from "./scorer-evidence";

const base = {
  externalId: "SU0900002IO",
  title: "Ozempic loss split screen",
  sourceUrl: "https://example.com/ad",
  angleSlug: "heavy-legs",
  format: "UGC",
  marketCode: "uk",
  durationSec: 30,
  evidenceLevel: "probable_winner" as const,
  intent: "structural_candidate" as const,
  performanceEvidence: "Observed running for 30 days",
  notes: null,
  scriptText: "HOOK A — SPLIT SCREEN\nVO: This is the complete example script.",
};

test("validates and normalizes scorer evidence", () => {
  const parsed = CreateScorerEvidenceSchema.parse(base);
  assert.equal(parsed.marketCode, "UK");
  assert.equal(scorerEvidenceHash(parsed).length, 64);
});

test("verified winner requires real performance evidence", () => {
  const parsed = CreateScorerEvidenceSchema.safeParse({ ...base, evidenceLevel: "verified_winner", performanceEvidence: "" });
  assert.equal(parsed.success, false);
});

test("detects alternative hooks without treating them as sequence", () => {
  assert.equal(countAlternativeHooks("HOOK A — ONE\ncopy\nHOOK B — TWO\ncopy\nHOOK C — THREE"), 3);
});

test("rejects malformed stored payloads", () => {
  assert.equal(parseScorerEvidencePayload(JSON.stringify({ title: "legacy" })), null);
});

