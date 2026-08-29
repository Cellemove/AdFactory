import assert from "node:assert/strict";
import test from "node:test";
import { buildScriptDisplayName, createInitialScriptDocument, inspectScriptQuality, renderScriptDownload, scriptDownloadFilename } from "./script-studio";

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
