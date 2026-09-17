import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceResultSchema, ReferenceSourceSchema, REFERENCE_MAX_BYTES, referenceBeats, reportMarkdown, scriptCsv, type ReferenceResult } from "./reference-analysis";
import { uploadedOffset } from "./reference-upload";
import { kindFromLabel, secondsFromBeat } from "./script-studio";

function fixture(): ReferenceResult {
  const finding = { observation: "A direct greeting", evidence_scene_ids: ["scene-0001"], interpretation: "Rapport hypothesis", creative_implication: "Test a visual opening", classification: "hypothesis" as const, confidence: "medium" as const };
  return { version: "reference_deep_dive_v1", duration_sec: 5, has_audio: true,
    scenes: [{ id: "scene-0001", start_sec: 0, end_sec: 5, visual: "Presenter, blue garment", audio: '"Hola, mundo."', overlays: "Text: ¡Hola!\nFx: Cut", uncertainty: "" }],
    framework: { name: "Direct opening", description: "Greet then demonstrate", best_for_angle: "Demonstrations", beats: [{ label: "Testimonial", kind: "proof", start_sec: 0, end_sec: 5, note: "Show approved customer evidence." }], strategy: { belief_progression: "Build trust", proof_requirements: "Approved evidence", pacing: "Show first", objections: "Address skepticism", adaptation_cautions: "Never invent a testimonial" } },
    deconstruction: { ad_name: "Demonstration", brand: "Not observable", product_category: "Garment", strategic_thesis: finding,
      sections: Array.from({ length: 14 }, (_, i) => ({ number: i + 1, findings: [{ ...finding }] })),
      experiments: [1, 2, 3].map(priority => ({ priority, change: "Test opening visual", rationale: "Compare clarity", evidence_scene_ids: ["scene-0001"], primary_metric: "3-second hold rate", interpretation: "Compare against the control" })) } };
}
test("complete contract preserves source-language text and all fourteen parts", () => {
  const parsed = ReferenceResultSchema.parse(fixture());
  assert.equal(parsed.scenes[0]?.audio, '"Hola, mundo."');
  assert.equal(parsed.deconstruction.sections.length, 14);
});
test("reject gaps, missing sections, nonexistent citations and mismatched duration", () => {
  for (const mutate of [
    (r: ReferenceResult) => { r.scenes[0]!.start_sec = 1; },
    (r: ReferenceResult) => { r.deconstruction.sections.pop(); },
    (r: ReferenceResult) => { r.deconstruction.strategic_thesis.evidence_scene_ids = ["invented"]; },
    (r: ReferenceResult) => { r.framework.beats[0]!.end_sec = 4; },
  ]) { const value = fixture(); mutate(value); assert.equal(ReferenceResultSchema.safeParse(value).success, false); }
});
test("200 MB boundary and non-video types are enforced", () => {
  const source = { mode: "upload", filename: "ad.mp4", mime_type: "video/mp4", size_bytes: REFERENCE_MAX_BYTES, url: "" };
  assert.equal(ReferenceSourceSchema.safeParse(source).success, true);
  assert.equal(ReferenceSourceSchema.safeParse({ ...source, size_bytes: REFERENCE_MAX_BYTES + 1 }).success, false);
  assert.equal(ReferenceSourceSchema.safeParse({ ...source, mime_type: "image/png" }).success, false);
});
test("framework adapter preserves existing module-kind and timing contracts", () => {
  const beat = referenceBeats(fixture().framework)[0]!;
  assert.equal(kindFromLabel(beat.label), "proof");
  assert.equal(secondsFromBeat(beat, 30), 5);
});
test("exports preserve four columns, quotes, multilingual text and formula safety", () => {
  const value = fixture(); value.scenes[0]!.visual = '=HYPERLINK("bad")';
  const csv = scriptCsv(value);
  assert.ok(csv.startsWith('\uFEFF"Timestamp","Visual / Graphic Scene","Audio / Voiceover","Editing Cues & Text Overlays"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('""Hola, mundo.""'));
  assert.ok(csv.includes("¡Hola!"));
  assert.ok(reportMarkdown(value).includes("PART 14: Prioritized experiments"));
  assert.ok(reportMarkdown(value).includes("00:00.00–00:05.00"));
});
test("resumable upload offsets use server-confirmed inclusive byte ranges", () => {
  assert.equal(uploadedOffset(null), 0);
  assert.equal(uploadedOffset("bytes=0-8388607"), 8388608);
  assert.throws(() => uploadedOffset("invalid"));
});
