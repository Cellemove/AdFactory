import assert from "node:assert/strict";
import test from "node:test";
import {
  imageAdReferenceSelectionError,
  imageAdReferencesReady,
  referenceImageQualityError,
  type ImageAdReferenceCandidate,
  type ImageAdReferenceSelection,
  type ImageAdReferenceSnapshot,
} from "./image-ad-references";

const candidates: ImageAdReferenceCandidate[] = [
  { id: "a", brandName: "Alpha", provider: "brandsearch", mediaType: "image", imageUrl: "https://x/a.jpg", winnerEvidence: "probable_winner" },
  { id: "b", brandName: "Beta", provider: "brandsearch", mediaType: "image", imageUrl: "https://x/b.jpg", winnerEvidence: "verified_winner" },
  { id: "c", brandName: "Beta", provider: "brandsearch", mediaType: "image", imageUrl: "https://x/c.jpg", winnerEvidence: "probable_winner" },
];

const valid: ImageAdReferenceSelection[] = [
  { adId: "a", roles: ["hook_message"] },
  { adId: "b", roles: ["layout_hierarchy"] },
  { adId: "c", roles: ["visual_format"] },
];

const snapshot = (id: string, brandName: string): ImageAdReferenceSnapshot => ({
  adId: id,
  provider: "brandsearch",
  externalId: `ext-${id}`,
  brandName,
  platform: "facebook",
  sourceUrl: null,
  providerImageUrl: `https://provider/${id}.jpg`,
  archivedImageUrl: `https://blob/${id}.jpg`,
  copy: "",
  winnerEvidence: "probable_winner",
  evidenceReasons: [],
  metrics: null,
  selectedAt: "2026-09-17T00:00:00.000Z",
  roles: ["hook_message"],
  analysis: "{}",
});

test("accepts 3–5 winning images spanning at least two competitors", () => {
  assert.equal(imageAdReferenceSelectionError(valid, candidates), null);
});

test("requires at least three references and two competitors", () => {
  assert.match(imageAdReferenceSelectionError(valid.slice(0, 2), candidates) ?? "", /3–5/);
  assert.match(
    imageAdReferenceSelectionError([
      { adId: "b", roles: ["layout_hierarchy"] },
      { adId: "c", roles: ["visual_format"] },
      { adId: "b", roles: ["proof_mechanism"] },
    ], candidates) ?? "",
    /only be selected once/,
  );
  // A reference that dropped out of the pool since it was picked.
  assert.match(
    imageAdReferenceSelectionError(valid, candidates.filter((candidate) => candidate.id !== "c")) ?? "",
    /no longer available/,
  );
});

test("rejects references without a role or winner evidence", () => {
  assert.match(imageAdReferenceSelectionError([{ ...valid[0]!, roles: [] }, valid[1]!, valid[2]!], candidates) ?? "", /role/);
  assert.match(
    imageAdReferenceSelectionError(valid, candidates.map((candidate) => candidate.id === "a" ? { ...candidate, winnerEvidence: "observed" } : candidate)) ?? "",
    /probable or verified/,
  );
});

test("a saved snapshot set is only ready when it still satisfies the same rules", () => {
  assert.equal(imageAdReferencesReady(undefined), false);
  assert.equal(imageAdReferencesReady([]), false);
  assert.equal(
    imageAdReferencesReady([snapshot("a", "Alpha"), snapshot("b", "Beta"), snapshot("c", "Beta")]),
    true,
  );
  // Three references, one competitor — not a usable cross-competitor set.
  assert.equal(
    imageAdReferencesReady([snapshot("a", "Alpha"), snapshot("b", "Alpha"), snapshot("c", "Alpha")]),
    false,
  );
});

test("the quality floor keeps real BrandSearch creatives and rejects thumbnails", () => {
  const kb = (n: number) => n * 1024;
  // The sizes BrandSearch actually serves.
  assert.equal(referenceImageQualityError({ width: 600, height: 600, byteSize: kb(80) }, "Alpha"), null);
  assert.equal(referenceImageQualityError({ width: 338, height: 600, byteSize: kb(50) }, "Alpha"), null);
  assert.equal(referenceImageQualityError({ width: 480, height: 600, byteSize: kb(60) }, "Alpha"), null);
  // The thumbnail fallback, and a placeholder-sized file.
  assert.match(referenceImageQualityError({ width: 120, height: 200, byteSize: kb(12) }, "Alpha") ?? "", /thumbnail/);
  assert.match(referenceImageQualityError({ width: 600, height: 600, byteSize: kb(2) }, "Alpha") ?? "", /2KB/);
});
