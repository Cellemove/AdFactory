import assert from "node:assert/strict";
import test from "node:test";
import { sortDeconstructedAds } from "./dump-usable";

const body = "have you ever heard of 3d micromassage leggings they use a special knit that massages your legs with every step you take so the skin looks smoother and your legs feel lighter by the end of the day over one hundred and fifty thousand pairs sold worldwide";
const other = "i was so tired of hiding my legs every summer so i tried something new my sister told me about these and honestly i did not believe her until week three when my jeans started fitting differently and my husband noticed before i did which never happens";

test("a re-cut (new hook, same body) points at the best-scoring ad of its script", () => {
  const verdicts = sortDeconstructedAds([
    { id: "recut", winnerScore: 60, product: "3D Sculpting Leggings", spoken: `stop scrolling if you hate your cellulite ${body}` },
    { id: "best", winnerScore: 90, product: "3D Leggings", spoken: `doctors hate this one trick ${body}` },
    { id: "different", winnerScore: 50, product: "Anti-Cellulite Leggings", spoken: other },
  ]);
  assert.deepEqual(verdicts.get("best"), { folder: "unique", duplicateOf: null, spokenWords: 52 });
  assert.equal(verdicts.get("recut")?.folder, "recuts");
  assert.equal(verdicts.get("recut")?.duplicateOf, "best");
  assert.equal(verdicts.get("different")?.folder, "unique");
});

test("another product is set aside even with the same script; a near-silent ad is never called a re-cut", () => {
  const verdicts = sortDeconstructedAds([
    { id: "bags", winnerScore: 99, product: "Travel Compression Vacuum Bags | Travel Accessories", spoken: body },
    { id: "leggings", winnerScore: 10, product: "3D Leggings", spoken: body },
    { id: "quiet-1", winnerScore: 5, product: "3D Leggings", spoken: "shop now" },
    { id: "quiet-2", winnerScore: 4, product: "3D Leggings", spoken: "shop now" },
  ]);
  assert.equal(verdicts.get("bags")?.folder, "other-products");
  assert.equal(verdicts.get("leggings")?.folder, "unique");
  assert.equal(verdicts.get("quiet-2")?.folder, "unique");
  assert.equal(verdicts.get("quiet-2")?.spokenWords, 2);
});
