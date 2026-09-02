import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUnsignedIntegerInput } from "../numeric-input";
import { parsePipelineRunSelection } from "./pipeline-selection";
import { buildScriptDisplayName, createInitialScriptDocument, ensureScriptDurationPlan, inspectScriptQuality, renderScriptDownload, scriptDownloadFilename } from "./script-studio";
import { canClaimScript, canEditScript, canSendScript, normalizeScriptWorkflowStatus } from "./script-workflow";

test("removes leading zeroes while preserving a single zero", () => {
  assert.equal(normalizeUnsignedIntegerInput("060"), "60");
  assert.equal(normalizeUnsignedIntegerInput("0005"), "5");
  assert.equal(normalizeUnsignedIntegerInput("0"), "0");
  assert.equal(normalizeUnsignedIntegerInput(""), "");
});

test("parses selectable pipeline runs and counts only completed stages", () => {
  assert.deepEqual(
    parsePipelineRunSelection(JSON.stringify({ subAvatarId: "avatar-1", angleSlug: "cellulite", stages: { rootCause: { ok: true }, brandDna: null, adScripts: { ok: true } } })),
    { subAvatarId: "avatar-1", angleSlug: "cellulite", completedStages: 2 },
  );
  assert.equal(parsePipelineRunSelection("not-json"), null);
});

test("builds the agreed stable naming convention", () => {
  assert.equal(
    buildScriptDisplayName({
      strategist: "SULEY",
      editor: "NYX",
      adNumber: "SU0800012",
      angle: "CELLULITE",
      creativeName: "CELLUMOVE VIRAL",
      productCode: "V1",
      createdAt: new Date(2026, 7, 17),
    }),
    "SULEY-NYX-SU0800012-CELLULITE-CELLUMOVE VIRAL-V1-81726",
  );
});

test("seeds a structured script and always includes a CTA", () => {
  const document = createInitialScriptDocument({
    title: "Viral concept",
    product: { id: "p1", name: "CelluMove", code: "V1" },
    avatar: null,
    angle: { id: "a1", name: "Cellulite" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "I stopped hiding my legs.",
    teardown: null,
  });
  assert.equal(document.schemaVersion, 1);
  assert.ok(document.modules.some((module) => module.kind === "cta"));
  assert.ok(inspectScriptQuality(document).length > 0);
});

test("expands a four-beat framework to fill a 60-second production plan", () => {
  const document = createInitialScriptDocument({
    title: "Detailed 60-second script",
    product: { id: "p1", name: "CelluMove", code: "V1" },
    avatar: null,
    angle: { id: "a1", name: "Cellulite" },
    framework: null,
    format: "UGC",
    targetDurationSec: 60,
    idea: "I stopped hiding my legs.",
    teardown: null,
  });

  assert.equal(document.modules.length, 8);
  assert.equal(document.modules.at(-1)?.kind, "cta");
  assert.ok(document.modules.some((module) => module.label === "How It Works"));
  assert.ok(document.modules.some((module) => module.label === "Proof & Demonstration"));
  assert.equal(document.modules.reduce((sum, module) => sum + module.durationSec, 0), 60);
  assert.ok(!inspectScriptQuality(document).some((issue) => issue.moduleId === "document"));
});

test("expands an existing short plan while preserving locked beat timing", () => {
  const document = createInitialScriptDocument({
    title: "Existing script",
    product: { id: "p1", name: "CelluMove", code: "V1" },
    avatar: null,
    angle: { id: "a1", name: "Cellulite" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "I stopped hiding my legs.",
    teardown: null,
  });
  document.targetDurationSec = 60;
  document.modules[0] = { ...document.modules[0]!, durationSec: 5, locked: true };

  const expanded = ensureScriptDurationPlan(document);
  assert.equal(expanded.modules.length, 8);
  assert.equal(expanded.modules[0]?.durationSec, 5);
  assert.equal(expanded.modules[0]?.locked, true);
  assert.equal(expanded.modules.reduce((sum, module) => sum + module.durationSec, 0), 60);
});

test("renders a readable production handoff with timing, B-roll, and sources", () => {
  const document = createInitialScriptDocument({
    title: "Vacation: Test / V1",
    product: { id: "p1", name: "3D Leggings", code: "V1" },
    avatar: { id: "av1", name: "Confidence Seeker" },
    angle: { id: "a1", name: "Anti-Cellulite" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "I stopped hiding my legs.",
    teardown: null,
  });
  document.modules[0]?.brollRefs.push({ clipId: "clip-1", name: "Product close-up", url: "https://example.com/clip" });
  document.sourceRefs.push({ type: "knowledge", id: "source-1", title: "Product research", url: "https://example.com/research" });

  const handoff = renderScriptDownload(document);
  assert.match(handoff, /VACATION: TEST \/ V1/);
  assert.match(handoff, /Product: 3D Leggings/);
  assert.match(handoff, /1\. HOOK \[HOOK\] — 0:00–0:03/);
  assert.match(handoff, /SPOKEN COPY\r\nI stopped hiding my legs\./);
  assert.match(handoff, /Product close-up — https:\/\/example\.com\/clip/);
  assert.match(handoff, /Product research — https:\/\/example\.com\/research/);
  assert.equal(scriptDownloadFilename(document), "Vacation-Test-V1-V1-script.txt");
});

test("normalizes the explicit editor handoff lifecycle", () => {
  assert.equal(normalizeScriptWorkflowStatus("draft", null), "draft");
  assert.equal(normalizeScriptWorkflowStatus("draft", "assigned"), "draft");
  assert.equal(normalizeScriptWorkflowStatus("review", "assigned"), "ready");
  assert.equal(normalizeScriptWorkflowStatus("assigned", "claimed"), "claimed");
  assert.equal(normalizeScriptWorkflowStatus("submitted", "submitted"), "submitted");
  assert.equal(normalizeScriptWorkflowStatus("changes_requested", "changes_requested"), "changes_requested");
  assert.equal(normalizeScriptWorkflowStatus("approved", "approved"), "approved");
  assert.equal(canEditScript("draft"), true);
  assert.equal(canEditScript("ready"), true);
  assert.equal(canEditScript("claimed"), true);
  assert.equal(canEditScript("submitted"), true);
  assert.equal(canEditScript("approved"), true);
  assert.equal(canSendScript("ready"), true);
  assert.equal(canSendScript("claimed"), false);
  assert.equal(canSendScript("changes_requested"), true);
  assert.equal(canClaimScript("ready"), true);
});
