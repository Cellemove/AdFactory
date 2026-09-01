import assert from "node:assert/strict";
import test from "node:test";
import { applyScriptModuleAssistRewrite, buildScriptModuleAssistContext } from "./script-module-assist";
import { createInitialScriptDocument } from "./script-studio";

function fixture() {
  return createInitialScriptDocument({
    title: "Module assist test",
    product: { id: "product-1", name: "3D Leggings", code: "V1" },
    avatar: { id: "avatar-1", name: "Confidence Seeker" },
    angle: { id: "angle-1", name: "Confidence" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "Feel confident getting dressed.",
    teardown: null,
  });
}

test("module assist preserves identity, kind, locks, claims, and B-roll", () => {
  const document = fixture();
  const original = {
    ...document.modules[0]!,
    locked: true,
    claimFlags: ["review:claim"],
    brollRefs: [{ clipId: "clip-1", name: "Fabric close-up", url: "https://example.com/clip" }],
  };
  const rewritten = applyScriptModuleAssistRewrite(original, {
    label: "Stronger opening",
    durationSec: 5,
    spokenText: "I finally felt confident getting dressed again.",
    onScreenText: "Confidence, restored.",
    visualDirection: "Open on a direct-to-camera reveal.",
    id: "malicious-replacement",
    kind: "cta",
    brollRefs: [],
    locked: false,
  });

  assert.equal(rewritten.id, original.id);
  assert.equal(rewritten.kind, original.kind);
  assert.equal(rewritten.locked, true);
  assert.deepEqual(rewritten.claimFlags, original.claimFlags);
  assert.deepEqual(rewritten.brollRefs, original.brollRefs);
  assert.equal(rewritten.spokenText, "I finally felt confident getting dressed again.");
});

test("module assist context clearly isolates strategist notes and the selected module", () => {
  const document = fixture();
  const targetModule = document.modules[1]!;
  const context = buildScriptModuleAssistContext({
    document,
    module: targetModule,
    notes: "Make the problem more conversational.",
  });

  assert.match(context, /<selected_module>/);
  assert.match(context, new RegExp(targetModule.id));
  assert.match(context, /<strategist_notes>\nMake the problem more conversational\.\n<\/strategist_notes>/);
  assert.match(context, /<surrounding_modules>/);
});
