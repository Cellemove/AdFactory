import { z } from "zod";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";
import { TeardownBriefSchema, type TeardownBrief, type TeardownInsight } from "@/lib/cellumove/teardown-brief";

export const SCRIPT_FORMATS = [
  "UGC",
  "Voiceover",
  "Founder",
  "Interview",
  "Testimonial",
  "Product demo",
  "Mixed media",
] as const;

export const ScriptModuleKindSchema = z.enum([
  "hook",
  "problem",
  "agitation",
  "solution",
  "proof",
  "offer",
  "cta",
  "custom",
]);

const BrollReferenceSchema = z.object({
  clipId: z.string().nullable(),
  name: z.string(),
  url: z.string().nullable(),
});

export const ScriptModuleSchema = z.object({
  id: z.string().min(1),
  kind: ScriptModuleKindSchema,
  label: z.string().min(1),
  durationSec: z.number().min(0).max(600),
  spokenText: z.string(),
  onScreenText: z.string(),
  visualDirection: z.string(),
  brollRefs: z.array(BrollReferenceSchema),
  locked: z.boolean(),
  claimFlags: z.array(z.string()),
});

export const ScriptDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  product: z.object({ id: z.string(), name: z.string(), code: z.string() }),
  avatar: z.object({ id: z.string(), name: z.string() }).nullable(),
  angle: z.object({ id: z.string(), name: z.string() }),
  framework: z.object({ id: z.string(), name: z.string() }).nullable(),
  format: z.string(),
  targetDurationSec: z.number().min(5).max(600),
  sourceRefs: z.array(z.object({ type: z.string(), id: z.string().nullable(), title: z.string(), url: z.string().nullable() })),
  teardownBrief: TeardownBriefSchema.nullable().optional(),
  hookAlternatives: z.array(z.object({ id: z.string(), text: z.string() })),
  selectedHookId: z.string().nullable(),
  modules: z.array(ScriptModuleSchema).min(1),
});

export type ScriptDocument = z.infer<typeof ScriptDocumentSchema>;
export type ScriptModule = z.infer<typeof ScriptModuleSchema>;

function teardownInsightForKind(
  kind: ScriptModule["kind"],
  brief: TeardownBrief,
): TeardownInsight | null {
  if (kind === "hook") return brief.hook[0] ?? null;
  if (kind === "problem" || kind === "agitation") return brief.problem[0] ?? brief.avatar[0] ?? null;
  if (kind === "solution") return brief.solution[0] ?? null;
  if (kind === "proof") return brief.proof[0] ?? null;
  if (kind === "offer") return brief.offer[0] ?? null;
  if (kind === "cta") return brief.cta[0] ?? brief.offer[0] ?? null;
  return brief.learnings[0] ?? null;
}

export function parseScriptDocument(value: unknown): ScriptDocument {
  return ScriptDocumentSchema.parse(value);
}

function kindFromLabel(label: string): ScriptModule["kind"] {
  const normalized = label.toLowerCase();
  if (/hook|dream outcome|one change|regret|test|frustration/.test(normalized)) return "hook";
  if (/problem|spiral|old way|why not me/.test(normalized)) return "problem";
  if (/solution|turning point|alternative|new way|mechanism|why it works/.test(normalized)) return "solution";
  if (/proof|reaction/.test(normalized)) return "proof";
  if (/offer/.test(normalized)) return "offer";
  if (/cta|relief/.test(normalized)) return "cta";
  return "custom";
}

function secondsFromBeat(beat: ReferenceFormatBeat, fallback: number): number {
  const values = beat.time.match(/\d+/g)?.map(Number) ?? [];
  if (values.length >= 2 && values[0] !== undefined && values[1] !== undefined) {
    return Math.max(1, values[1] - values[0]);
  }
  return fallback;
}

const TARGET_SECONDS_PER_BEAT = 8;

const DURATION_EXPANSION_BEATS: Array<Pick<ScriptModule, "kind" | "label" | "visualDirection">> = [
  {
    kind: "agitation",
    label: "Stakes & Daily Impact",
    visualDirection: "Show a specific everyday moment where the problem becomes frustrating or emotionally costly.",
  },
  {
    kind: "solution",
    label: "How It Works",
    visualDirection: "Demonstrate the product mechanism clearly with a close-up, comparison, or step-by-step product moment.",
  },
  {
    kind: "proof",
    label: "Proof & Demonstration",
    visualDirection: "Show the strongest supportable proof, product detail, result, or real-use demonstration available in the resources.",
  },
  {
    kind: "proof",
    label: "Objection Handler",
    visualDirection: "Address the audience's most likely hesitation with a concrete visual answer and grounded reassurance.",
  },
  {
    kind: "solution",
    label: "Product Experience",
    visualDirection: "Show how the product looks, feels, fits, or is used in a believable day-to-day setting.",
  },
  {
    kind: "offer",
    label: "Offer & Options",
    visualDirection: "Present only verified product options or offer details, then transition naturally toward the next step.",
  },
  {
    kind: "custom",
    label: "Emotional Payoff",
    visualDirection: "Return to the desired outcome and show the audience's believable emotional change after using the product.",
  },
  {
    kind: "custom",
    label: "Key Takeaway",
    visualDirection: "Recap the clearest product benefit in a fresh visual before the final call to action.",
  },
];

function nextModuleId(modules: ScriptModule[]): string {
  const usedIds = new Set(modules.map((module) => module.id));
  let index = modules.length + 1;
  while (usedIds.has(`module-${index}`)) index += 1;
  return `module-${index}`;
}

function allocateExactDuration(modules: ScriptModule[], targetDurationSec: number): ScriptModule[] {
  const currentDuration = modules.reduce((sum, module) => sum + module.durationSec, 0);
  if (currentDuration === targetDurationSec) return modules;

  const lockedDuration = modules.reduce((sum, module) => sum + (module.locked ? module.durationSec : 0), 0);
  const editable = modules.map((module, index) => ({ module, index })).filter(({ module }) => !module.locked);
  if (!editable.length) return modules;

  const available = Math.round(targetDurationSec - lockedDuration);
  if (available < editable.length) {
    return modules.map((module) => module.locked ? module : { ...module, durationSec: 1 });
  }

  const remainingAfterMinimums = available - editable.length;
  const totalWeight = editable.reduce((sum, { module }) => sum + Math.max(1, module.durationSec), 0);
  const allocations = editable.map(({ module, index }) => {
    const exactShare = remainingAfterMinimums * (Math.max(1, module.durationSec) / totalWeight);
    return {
      index,
      durationSec: 1 + Math.floor(exactShare),
      remainder: exactShare - Math.floor(exactShare),
    };
  });
  let unallocated = available - allocations.reduce((sum, allocation) => sum + allocation.durationSec, 0);
  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((allocation) => {
      if (unallocated <= 0) return;
      const original = allocations.find((candidate) => candidate.index === allocation.index);
      if (original) original.durationSec += 1;
      unallocated -= 1;
    });
  const durationByIndex = new Map(allocations.map((allocation) => [allocation.index, allocation.durationSec]));
  return modules.map((module, index) => module.locked
    ? module
    : { ...module, durationSec: durationByIndex.get(index) ?? module.durationSec });
}

/**
 * Expands short framework outlines into a production-ready beat plan and makes
 * the editable timing total exactly match the requested duration.
 */
export function ensureScriptDurationPlan(document: ScriptDocument): ScriptDocument {
  const parsed = ScriptDocumentSchema.parse(document);
  const minimumBeatCount = Math.max(parsed.modules.length, Math.ceil(parsed.targetDurationSec / TARGET_SECONDS_PER_BEAT));
  const modules = parsed.modules.map((module) => ({ ...module }));
  const firstCtaIndex = modules.findIndex((module) => module.kind === "cta");
  const insertionIndex = firstCtaIndex >= 0 ? firstCtaIndex : modules.length;
  const labels = new Set(modules.map((module) => module.label.toLocaleLowerCase()));
  let expansionIndex = 0;

  while (modules.length < minimumBeatCount) {
    const template = DURATION_EXPANSION_BEATS[expansionIndex % DURATION_EXPANSION_BEATS.length]!;
    const cycle = Math.floor(expansionIndex / DURATION_EXPANSION_BEATS.length) + 1;
    const baseLabel = template.label;
    const label = labels.has(baseLabel.toLocaleLowerCase()) || cycle > 1 ? `${baseLabel} ${cycle + 1}` : baseLabel;
    const module: ScriptModule = {
      id: nextModuleId(modules),
      kind: template.kind,
      label,
      durationSec: TARGET_SECONDS_PER_BEAT,
      spokenText: "",
      onScreenText: "",
      visualDirection: template.visualDirection,
      brollRefs: [],
      locked: false,
      claimFlags: [],
    };
    modules.splice(insertionIndex + expansionIndex, 0, module);
    labels.add(label.toLocaleLowerCase());
    expansionIndex += 1;
  }

  return ScriptDocumentSchema.parse({
    ...parsed,
    modules: allocateExactDuration(modules, parsed.targetDurationSec),
  });
}

export function createInitialScriptDocument(input: {
  title: string;
  product: { id: string; name: string; code: string };
  avatar: { id: string; name: string } | null;
  angle: { id: string; name: string };
  framework: { id: string; name: string; beats: ReferenceFormatBeat[] } | null;
  format: string;
  targetDurationSec: number;
  idea: string;
  teardown: { id: string; title: string; url: string | null; brief: TeardownBrief } | null;
}): ScriptDocument {
  const fallbackBeats: ReferenceFormatBeat[] = [
    { label: "Hook", time: "0-3s", note: "Stop the scroll and open the core idea." },
    { label: "Problem", time: "3-10s", note: "Name the audience's specific problem in their language." },
    { label: "Solution + Proof", time: "10-24s", note: "Explain the product mechanism and show believable proof." },
    { label: "CTA", time: "24-30s", note: "Make a clear, low-pressure next step." },
  ];
  const beats = input.framework?.beats.length ? input.framework.beats : fallbackBeats;
  const fallbackDuration = Math.max(1, Math.round(input.targetDurationSec / beats.length));
  const modules = beats.map((beat, index): ScriptModule => {
    const kind = kindFromLabel(beat.label);
    const insight = input.teardown ? teardownInsightForKind(kind, input.teardown.brief) : null;
    return {
      id: `module-${index + 1}`,
      kind,
      label: beat.label,
      durationSec: secondsFromBeat(beat, fallbackDuration),
      spokenText: index === 0 ? input.idea : "",
      onScreenText: "",
      visualDirection: [
        beat.note,
        insight ? `Teardown reference — ${insight.label}: ${insight.value}` : "",
      ].filter(Boolean).join(" "),
      brollRefs: [],
      locked: false,
      claimFlags: [],
    };
  });

  if (!modules.some((module) => module.kind === "cta")) {
    modules.push({
      id: `module-${modules.length + 1}`,
      kind: "cta",
      label: "CTA",
      durationSec: 3,
      spokenText: "",
      onScreenText: "",
      visualDirection: "Show the product and a clear next step.",
      brollRefs: [],
      locked: false,
      claimFlags: [],
    });
  }

  return ensureScriptDurationPlan(ScriptDocumentSchema.parse({
    schemaVersion: 1,
    title: input.title,
    product: input.product,
    avatar: input.avatar,
    angle: input.angle,
    framework: input.framework ? { id: input.framework.id, name: input.framework.name } : null,
    format: input.format,
    targetDurationSec: input.targetDurationSec,
    sourceRefs: input.teardown ? [{ type: "teardown", id: input.teardown.id, title: input.teardown.title, url: input.teardown.url }] : [],
    teardownBrief: input.teardown?.brief ?? null,
    hookAlternatives: (input.teardown?.brief.hook ?? []).slice(0, 5).map((insight, index) => ({
      id: `teardown-hook-${index + 1}`,
      text: insight.value,
    })),
    selectedHookId: null,
    modules,
  }));
}

function namingPart(value: string, fallback: string): string {
  const clean = value
    .normalize("NFKD")
    .replace(/[–—-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return clean || fallback;
}

export function formatNamingDate(date: Date): string {
  return `${date.getMonth() + 1}${date.getDate()}${String(date.getFullYear()).slice(-2)}`;
}

export function buildScriptDisplayName(input: {
  strategist: string;
  editor: string | null;
  adNumber: string;
  angle: string;
  creativeName: string;
  productCode: string;
  createdAt: Date;
}): string {
  return [
    namingPart(input.strategist, "STRATEGIST"),
    namingPart(input.editor ?? "", "UNASSIGNED"),
    namingPart(input.adNumber, "AD"),
    namingPart(input.angle, "ANGLE"),
    namingPart(input.creativeName, "UNTITLED"),
    namingPart(input.productCode, "PRODUCT"),
    formatNamingDate(input.createdAt),
  ].join("-");
}

export interface ScriptQualityIssue {
  moduleId: string;
  severity: "warning" | "error";
  message: string;
}

export function inspectScriptQuality(document: ScriptDocument): ScriptQualityIssue[] {
  const issues: ScriptQualityIssue[] = [];
  const filler = /\b(very|really|actually|basically|literally|just)\b/gi;
  const riskyClaim = /\b(cure|guarantee(?:d)?|clinically proven|eliminate(?:s|d)? cellulite)\b/i;

  for (const beatModule of document.modules) {
    const sentences = beatModule.spokenText.split(/[.!?]+/).map((value) => value.trim()).filter(Boolean);
    if (sentences.some((sentence) => sentence.split(/\s+/).length > 22)) {
      issues.push({ moduleId: beatModule.id, severity: "warning", message: "A spoken sentence exceeds 22 words; shorten it for delivery." });
    }
    const fillerCount = beatModule.spokenText.match(filler)?.length ?? 0;
    if (fillerCount >= 2) {
      issues.push({ moduleId: beatModule.id, severity: "warning", message: "This beat contains repeated filler words." });
    }
    if (riskyClaim.test(`${beatModule.spokenText} ${beatModule.onScreenText}`)) {
      issues.push({ moduleId: beatModule.id, severity: "error", message: "Potentially unsupported or prohibited claim." });
    }
    if (!beatModule.spokenText.trim() && !beatModule.onScreenText.trim()) {
      issues.push({ moduleId: beatModule.id, severity: "warning", message: "This beat has no copy yet." });
    }
  }

  const totalDuration = document.modules.reduce((sum, module) => sum + module.durationSec, 0);
  if (Math.abs(totalDuration - document.targetDurationSec) > 3) {
    issues.push({ moduleId: "document", severity: "warning", message: `Beat timing totals ${totalDuration}s, not the ${document.targetDurationSec}s target.` });
  }
  return issues;
}

function formatScriptTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function downloadValue(value: string | null | undefined): string {
  return value?.trim() || "—";
}

export function scriptDownloadFilename(document: ScriptDocument): string {
  const parts = [document.title, document.product.code, "script"]
    .map((part) => part.normalize("NFKD").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);

  return `${parts.join("-").slice(0, 100) || "script"}.txt`;
}

export function renderScriptDownload(document: ScriptDocument): string {
  const totalDuration = document.modules.reduce((sum, module) => sum + module.durationSec, 0);
  const lines: string[] = [
    document.title.toUpperCase(),
    "=".repeat(Math.max(12, document.title.length)),
    "",
    `Product: ${downloadValue(document.product.name)}`,
    `Product code: ${downloadValue(document.product.code)}`,
    `Avatar: ${downloadValue(document.avatar?.name)}`,
    `Angle: ${downloadValue(document.angle.name)}`,
    `Framework: ${downloadValue(document.framework?.name)}`,
    `Format: ${downloadValue(document.format)}`,
    `Target duration: ${document.targetDurationSec} seconds`,
    `Script duration: ${totalDuration} seconds`,
  ];

  if (document.hookAlternatives.length > 0) {
    lines.push("", "HOOK OPTIONS", "------------");
    document.hookAlternatives.forEach((hook, index) => {
      const selected = hook.id === document.selectedHookId ? " [SELECTED]" : "";
      lines.push(`${index + 1}. ${hook.text}${selected}`);
    });
  }

  lines.push("", "SCRIPT", "------");
  let elapsedSeconds = 0;
  document.modules.forEach((module, index) => {
    const start = elapsedSeconds;
    elapsedSeconds += module.durationSec;
    lines.push(
      "",
      `${index + 1}. ${module.label.toUpperCase()} [${module.kind.toUpperCase()}] — ${formatScriptTimestamp(start)}–${formatScriptTimestamp(elapsedSeconds)}`,
      "",
      "SPOKEN COPY",
      downloadValue(module.spokenText),
      "",
      "ON-SCREEN TEXT",
      downloadValue(module.onScreenText),
      "",
      "VISUAL DIRECTION",
      downloadValue(module.visualDirection),
    );

    if (module.brollRefs.length > 0) {
      lines.push("", "MATCHED B-ROLL");
      module.brollRefs.forEach((clip) => {
        lines.push(`- ${clip.name}${clip.url ? ` — ${clip.url}` : ""}`);
      });
    }
  });

  if (document.sourceRefs.length > 0) {
    lines.push("", "SOURCES", "-------");
    document.sourceRefs.forEach((source) => {
      lines.push(`- ${source.title}${source.url ? ` — ${source.url}` : ""}`);
    });
  }

  return `${lines.join("\r\n")}\r\n`;
}
