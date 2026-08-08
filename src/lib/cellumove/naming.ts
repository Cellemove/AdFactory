// Canonical iteration naming.
// Format: IT[N]-[LEVEL]-[EDITOR]-[ORIGINAL_AD_NAME]-[HOOK]
// Rules:
//   - LEVEL ∈ {easy, medium, hard}
//   - EDITOR ∈ {MO, VA, DO}. SU is banned.
//   - ORIGINAL_AD_NAME and HOOK are slugified (hyphen-case, alphanumeric).
// The legacy `IT1-Singing-Cellulitis-easy-...` format is deprecated.

import { BANNED_EDITORS, EDITORS, LEVELS, type Editor, type Level } from "./constants";

export interface IterationNameInput {
  iterationNumber: number;
  level: Level;
  editor: Editor;
  originalAdName: string;
  hookSlug: string;
}

export function slugifyPart(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildIterationName(input: IterationNameInput): string {
  if (!Number.isInteger(input.iterationNumber) || input.iterationNumber < 1) {
    throw new Error("iterationNumber must be a positive integer");
  }
  if (!LEVELS.includes(input.level)) {
    throw new Error(`Invalid level: ${input.level}`);
  }
  if (!EDITORS.includes(input.editor)) {
    throw new Error(`Invalid editor: ${input.editor}`);
  }
  if ((BANNED_EDITORS as readonly string[]).includes(input.editor)) {
    throw new Error(`Editor ${input.editor} is reserved and may not be used.`);
  }
  const ad = slugifyPart(input.originalAdName);
  const hook = slugifyPart(input.hookSlug);
  if (!ad) throw new Error("originalAdName slugifies to empty");
  if (!hook) throw new Error("hookSlug slugifies to empty");
  return `IT${input.iterationNumber}-${input.level}-${input.editor}-${ad}-${hook}`;
}

const ITERATION_NAME_RE =
  /^IT(\d+)-(easy|medium|hard)-(MO|VA|DO)-([a-z0-9-]+)-([a-z0-9-]+)$/;

export interface ParsedIterationName extends IterationNameInput {}

export function parseIterationName(name: string): ParsedIterationName | null {
  const m = ITERATION_NAME_RE.exec(name);
  if (!m) return null;
  return {
    iterationNumber: Number(m[1]),
    level: m[2] as Level,
    editor: m[3] as Editor,
    originalAdName: m[4]!,
    hookSlug: m[5]!,
  };
}

export function isValidIterationName(name: string): boolean {
  return ITERATION_NAME_RE.test(name);
}
