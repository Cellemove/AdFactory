import assert from "node:assert/strict";
import test from "node:test";
import {
  batchComplete,
  candidateCounts,
  duplicateHeadlineSlots,
  planDirectionSizes,
  planSourceMix,
  referenceInformedCount,
  type ImageAdCandidate,
  type ImageAdCandidateStatus,
} from "./image-ad-concepts";
import { IMAGE_AD_TARGET_COUNTS } from "./image-ad-batch";

function candidate(slot: number, headline: string, status: ImageAdCandidateStatus = "planned"): ImageAdCandidate {
  return {
    slot,
    concept: {
      direction: "d",
      execution: "e",
      headline,
      bodyCopy: "",
      cta: "Shop now",
      visualInstructions: "",
      rationale: "",
      source: "original",
      sourceReferenceIds: [],
      rolesUsed: [],
    },
    status,
    imageUrl: status === "ready" ? "/uploads/image-ad-candidates/x.png" : null,
    width: null,
    height: null,
    attempts: 0,
    error: null,
    generatedAt: null,
  };
}

test("the source mix stays inside 60-70% reference-informed for every batch size", () => {
  for (const total of IMAGE_AD_TARGET_COUNTS) {
    const mix = planSourceMix(total);
    assert.equal(mix.length, total, `${total} slots`);
    const share = mix.filter((source) => source === "reference_informed").length / total;
    assert.ok(share >= 0.6 && share <= 0.7, `${total} ads gave a ${(share * 100).toFixed(0)}% reference share`);
    assert.equal(referenceInformedCount(total), mix.filter((s) => s === "reference_informed").length);
  }
});

test("direction sizes always sum to the exact requested total", () => {
  for (const total of [...IMAGE_AD_TARGET_COUNTS, 7, 1]) {
    const sizes = planDirectionSizes(total);
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), total);
    assert.ok(sizes.every((size) => size > 0 && size <= 5));
  }
  assert.deepEqual(planDirectionSizes(0), []);
});

test("counts separate ready work from failed and pending", () => {
  const candidates = [
    candidate(0, "a", "ready"),
    candidate(1, "b", "failed"),
    candidate(2, "c", "planned"),
  ];
  assert.deepEqual(candidateCounts(candidates), { total: 3, ready: 1, failed: 1, pending: 2 });
});

test("a batch is complete only when every requested slot is ready", () => {
  const ready = [candidate(0, "a", "ready"), candidate(1, "b", "ready")];
  assert.equal(batchComplete(ready, 2), true);
  assert.equal(batchComplete(ready, 3), false, "fewer candidates than requested");
  assert.equal(batchComplete([candidate(0, "a", "ready"), candidate(1, "b", "failed")], 2), false);
});

test("flags repeated and contained headlines before rendering", () => {
  const duplicates = duplicateHeadlineSlots([
    candidate(0, "Sculpt your silhouette"),
    candidate(1, "SCULPT YOUR SILHOUETTE!"),
    candidate(2, "Sculpt your silhouette in seconds"),
    candidate(3, "A totally different promise"),
  ]);
  assert.deepEqual(duplicates, [1, 2]);
});
