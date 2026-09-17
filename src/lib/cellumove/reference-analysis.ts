import { z } from "zod";
import { enforceKind } from "./framework-extraction";

export const REFERENCE_ANALYSIS_VERSION = "reference_deep_dive_v1";
export const REFERENCE_MAX_BYTES = 200 * 1024 * 1024;
export const REFERENCE_MAX_SECONDS = 600;
export const REFERENCE_SECTIONS = ["Avatar psychology", "Hook", "Problem amplification", "Solution introduction", "Proof sequence", "Transformation promise", "Psychological triggers", "Visual and audio analysis", "Language and copy", "Offer and CTA", "Competitive positioning", "Performance hypotheses and weaknesses", "Transferable learning", "Prioritized experiments"];
export const REFERENCE_STAGES: Record<string, string> = {
  uploading: "Waiting for video upload", queued: "Queued for analysis", validating: "Validating video",
  storyboard: "Transcribing scenes", deconstruction: "Analyzing persuasion", framework: "Preparing the framework", completed: "Ready to review",
};

export const ReferenceSourceSchema = z.object({
  mode: z.enum(["upload", "youtube", "url"]), filename: z.string().max(200).default(""),
  mime_type: z.enum(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]).default("video/mp4"),
  size_bytes: z.number().int().min(0).max(REFERENCE_MAX_BYTES).default(0), url: z.string().max(2000).default(""),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "upload") {
    if (!value.filename || !value.size_bytes || value.url) ctx.addIssue({ code: "custom", message: "Choose a nonempty video up to 200 MB." });
  } else if (!z.string().url().safeParse(value.url).success || !/^https?:\/\//i.test(value.url)) {
    ctx.addIssue({ code: "custom", message: "Paste a public HTTP(S) video link." });
  }
});
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;

const SceneSchema = z.object({
  id: z.string().min(1), start_sec: z.number().min(0).max(600), end_sec: z.number().positive().max(600),
  visual: z.string().min(1).max(6000), audio: z.string().min(1).max(6000), overlays: z.string().min(1).max(6000), uncertainty: z.string().max(2000),
}).strict();
const FindingSchema = z.object({
  observation: z.string().min(1).max(4000), evidence_scene_ids: z.array(z.string()).max(20),
  interpretation: z.string().min(1).max(4000), creative_implication: z.string().min(1).max(4000),
  classification: z.enum(["observation", "hypothesis", "recommendation", "not_observable"]), confidence: z.enum(["high", "medium", "low"]),
}).strict();
export type ReferenceFinding = z.infer<typeof FindingSchema>;
export const ReferenceStrategySchema = z.object({
  belief_progression: z.string().trim().min(1).max(3000), proof_requirements: z.string().trim().min(1).max(3000),
  pacing: z.string().trim().min(1).max(3000), objections: z.string().trim().min(1).max(3000), adaptation_cautions: z.string().trim().min(1).max(3000),
}).strict();
export const ReferenceFrameworkSchema = z.object({
  name: z.string().trim().min(2).max(80), description: z.string().trim().min(1).max(600), best_for_angle: z.string().trim().min(1).max(1000),
  beats: z.array(z.object({ label: z.string().trim().min(1).max(60), kind: z.enum(["hook", "problem", "agitation", "solution", "proof", "offer", "cta", "custom"]), start_sec: z.number().int().min(0).max(600), end_sec: z.number().int().positive().max(600), note: z.string().trim().min(5).max(400) }).strict()).min(1).max(10),
  strategy: ReferenceStrategySchema,
}).strict();
export type ReferenceFramework = z.infer<typeof ReferenceFrameworkSchema>;
export const ReferenceResultSchema = z.object({
  version: z.literal(REFERENCE_ANALYSIS_VERSION), duration_sec: z.number().min(1).max(600), has_audio: z.boolean(),
  scenes: z.array(SceneSchema).min(1).max(10000), framework: ReferenceFrameworkSchema,
  deconstruction: z.object({
    ad_name: z.string(), brand: z.string(), product_category: z.string(), strategic_thesis: FindingSchema,
    sections: z.array(z.object({ number: z.number().int().min(1).max(14), findings: z.array(FindingSchema).min(1).max(8) }).strict()).length(14),
    experiments: z.array(z.object({ priority: z.number().int().min(1).max(5), change: z.string(), rationale: z.string(), evidence_scene_ids: z.array(z.string()).min(1), primary_metric: z.string(), interpretation: z.string() }).strict()).min(3).max(5),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  let cursor = 0;
  const known = new Set(value.scenes.map(s => s.id));
  if (known.size !== value.scenes.length) fail("Duplicate scene IDs");
  for (const scene of value.scenes) {
    if (Math.abs(scene.start_sec - cursor) > 0.15 || scene.end_sec <= scene.start_sec || scene.end_sec > value.duration_sec + 0.15) fail("Invalid scene coverage");
    cursor = scene.end_sec;
  }
  if (Math.abs(cursor - value.duration_sec) > 0.15) fail("Incomplete scene coverage");
  if (value.deconstruction.sections.some((s, i) => s.number !== i + 1)) fail("Missing or repeated section");
  const findings = [value.deconstruction.strategic_thesis, ...value.deconstruction.sections.flatMap(s => s.findings)];
  for (const item of [...findings, ...value.deconstruction.experiments]) {
    if (item.evidence_scene_ids.some(id => !known.has(id))) fail("Unknown evidence scene");
  }
  if (findings.some(f => !f.evidence_scene_ids.length && f.classification !== "not_observable")) fail("Finding has no evidence");
  if (!validFrameworkTimeline(value.framework, value.duration_sec)) fail("Invalid framework timeline");
});
export type ReferenceResult = z.infer<typeof ReferenceResultSchema>;

export function validFrameworkTimeline(framework: ReferenceFramework, duration: number): boolean {
  let cursor = 0;
  for (const beat of framework.beats) {
    if (beat.start_sec !== cursor || beat.end_sec <= cursor) return false;
    cursor = beat.end_sec;
  }
  return cursor === Math.round(duration);
}
export function referenceBeats(framework: ReferenceFramework) {
  return framework.beats.map(b => ({ label: enforceKind(b.label, b.kind), time: `${b.start_sec}–${b.end_sec}s`, note: b.note }));
}
export const ReferenceJobSchema = z.object({
  id: z.string().uuid(), source: ReferenceSourceSchema, status: z.enum(["uploading", "queued", "processing", "completed", "failed"]),
  stage: z.string(), version: z.literal(REFERENCE_ANALYSIS_VERSION), result: z.unknown(), error: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});
export interface ReferenceAnalysis {
  id: string; source: ReferenceSource; status: string; stage: string; error: string | null;
  result: ReferenceResult | null; referenceFormatId: string | null; nameOverride: string; createdAt: string;
  approvedFramework?: ReferenceFramework;
}
export function timestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
export function sceneTime(scene: { start_sec: number; end_sec: number }): string { return `${timestamp(scene.start_sec)}–${timestamp(scene.end_sec)}`; }
export function reportMarkdown(report: ReferenceResult): string {
  const cite = (ids: string[]) => ids.map(id => { const s = report.scenes.find(s => s.id === id); return s ? sceneTime(s) : id; }).join(", ");
  const finding = (f: ReferenceFinding) => `**${f.classification.replaceAll("_", " ")} · ${f.confidence} confidence** (${cite(f.evidence_scene_ids) || "Not observable"})\n\n${f.observation}\n\n**Interpretation:** ${f.interpretation}\n\n**Creative implication:** ${f.creative_implication}`;
  return [`# Ad Overview and Strategic Thesis`, `**Ad:** ${report.deconstruction.ad_name}\n\n**Brand:** ${report.deconstruction.brand}\n\n**Category:** ${report.deconstruction.product_category}\n\n**Duration:** ${timestamp(report.duration_sec)}`, finding(report.deconstruction.strategic_thesis),
    ...report.deconstruction.sections.map(s => `## PART ${s.number}: ${REFERENCE_SECTIONS[s.number - 1]}\n\n${s.findings.map(finding).join("\n\n---\n\n")}`),
    ...report.deconstruction.experiments.map(e => `### Experiment ${e.priority}\n\n**Change:** ${e.change}\n\n**Rationale:** ${e.rationale}\n\n**Evidence:** ${cite(e.evidence_scene_ids)}\n\n**Primary metric:** ${e.primary_metric}\n\n**Interpretation:** ${e.interpretation}`),
    `Analysis version: ${report.version}. Creative hypotheses are not verified performance evidence.`].join("\n\n");
}
export function scriptCsv(report: ReferenceResult): string {
  const cell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return "\uFEFF" + [["Timestamp", "Visual / Graphic Scene", "Audio / Voiceover", "Editing Cues & Text Overlays"],
    ...report.scenes.map(s => [sceneTime(s), s.visual, s.audio, s.overlays + (s.uncertainty ? `\nUncertainty: ${s.uncertainty}` : "")])].map(row => row.map(cell).join(",")).join("\r\n");
}
