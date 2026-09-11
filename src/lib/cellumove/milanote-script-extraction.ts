import { z } from "zod";

export const MAX_MILANOTE_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Second line of defence after the geometric column selection in
 * `milanote-board.ts`: even if a board author drops prompt text into a card
 * that sits inside a HOOK/BODY column, it is dropped here rather than saved as
 * script evidence.
 */
const EXCLUDED_LABEL_PATTERN = /(?:system\s*prompt|prompt|instruction|brief|idea|marketing\s+information|deconstruction|reference|research|documents?)/i;
const EXCLUDED_CONTENT_PATTERN = /(?:you are a world-class creative strategist|your objective is to create|apply the enhanced prompt|non-negotiable:|who you are working with|return only (?:this )?json)/i;

export const MilanoteScriptSectionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(50_000),
}).strict();

export const MilanoteScriptExtractionSchema = z.object({
  sections: z.array(MilanoteScriptSectionSchema).min(1).max(30),
  excludedLabels: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
}).strict();

export type MilanoteScriptExtraction = z.infer<typeof MilanoteScriptExtractionSchema>;

export function normalizeMilanoteExtraction(value: unknown): MilanoteScriptExtraction {
  const parsed = MilanoteScriptExtractionSchema.parse(value);
  const sections = parsed.sections
    .filter((section) => !isExcludedMilanoteSection(section))
    .map(removeRepeatedHeading)
    .filter((section) => section.content.trim().length > 0);
  if (!sections.length) {
    throw new Error("No final script sections remained after system prompts and planning material were excluded.");
  }
  return {
    sections,
    excludedLabels: [...new Set(parsed.excludedLabels.map((label) => label.trim()).filter((label) => label.length >= 3))],
  };
}

export function buildMilanoteScriptText(extraction: MilanoteScriptExtraction): string {
  return extraction.sections
    .map((section) => `## ${section.label.trim()}\n${section.content.trim()}`)
    .join("\n\n");
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

export function isExcludedMilanoteSection(section: { label: string; content: string }): boolean {
  return EXCLUDED_LABEL_PATTERN.test(section.label) || EXCLUDED_CONTENT_PATTERN.test(section.content);
}

function removeRepeatedHeading(section: { label: string; content: string }): { label: string; content: string } {
  const lines = section.content.trim().split(/\r?\n/);
  if (normalizeHeading(lines[0] ?? "") === normalizeHeading(section.label)) lines.shift();
  return { label: section.label.trim(), content: lines.join("\n").trim() };
}

function normalizeHeading(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
