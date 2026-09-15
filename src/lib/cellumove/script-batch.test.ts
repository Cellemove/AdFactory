import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchVariants, mapWithConcurrency, MAX_BATCH_VARIANTS } from "./script-batch";
import { HOOK_MECHANICS } from "./formats";
import { canEditScript, normalizeScriptWorkflowStatus } from "./script-workflow";
import type { CreateScriptProjectInput } from "./create-script-project.server";

const base: CreateScriptProjectInput = {
  title: "Base title",
  idea: "The idea to prove.",
  adNumber: "SU1",
  creativeName: "BaseCreative",
  productId: "p1",
  subAvatarId: "a1",
  strategistUserId: "u1",
  format: "UGC",
  targetDurationSec: 60,
  hookDirection: "her own vein in frame",
};

test("hook-mechanics axis builds one directed variant per mechanic", () => {
  const mechanics = HOOK_MECHANICS.slice(0, 3);
  const variants = buildBatchVariants(base, { hookMechanics: mechanics });
  assert.equal(variants.length, 3);
  for (const [index, variant] of variants.entries()) {
    const mechanic = mechanics[index]!;
    assert.ok(variant.input.hookDirection!.includes(mechanic.name));
    assert.ok(variant.input.hookDirection!.includes(mechanic.example));
    // The brief's own hook direction is honoured, not replaced.
    assert.ok(variant.input.hookDirection!.includes("her own vein in frame"));
    assert.ok(variant.input.title!.includes(mechanic.name));
  }
});

test("mechanics × heat cross product, cap enforced", () => {
  const variants = buildBatchVariants(base, {
    hookMechanics: HOOK_MECHANICS.slice(0, 3),
    heatLevels: [2, 3],
  });
  assert.equal(variants.length, 6);
  assert.ok(variants.some((variant) => variant.input.heatLevel === 2));
  assert.ok(variants.some((variant) => variant.input.heatLevel === 3));
  assert.throws(
    () => buildBatchVariants(base, { hookMechanics: HOOK_MECHANICS.slice(0, 6), heatLevels: [1, 2, 3] }),
    new RegExp(`ceiling is ${MAX_BATCH_VARIANTS}`),
  );
});

test("framework axis unchanged; frameworks refuse to combine with other axes", () => {
  const variants = buildBatchVariants(base, { frameworks: [{ id: "f1", name: "Spine A" }, { id: "f2", name: "Spine B" }] });
  assert.equal(variants.length, 2);
  assert.equal(variants[0]!.input.referenceFormatId, "f1");
  assert.throws(() => buildBatchVariants(base, { frameworks: [{ id: "f1", name: "A" }], heatLevels: [1, 2] }));
});

test("heat-only axis works; empty axes throw", () => {
  const variants = buildBatchVariants(base, { heatLevels: [1, 4] });
  assert.equal(variants.length, 2);
  assert.equal(variants[1]!.input.heatLevel, 4);
  assert.throws(() => buildBatchVariants(base, {}));
});

test("mapWithConcurrency preserves order and honours the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([10, 20, 30, 40, 50], 2, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [20, 40, 60, 80, 100]);
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test("archived status: normalized, read-only, hidden from send/claim", () => {
  assert.equal(normalizeScriptWorkflowStatus("archived"), "archived");
  assert.equal(canEditScript("archived"), false);
  assert.equal(canEditScript("draft"), true);
});
