// Deterministic claim/compliance scan for generated copy (Fix 2 of the VoC system).
// Reuses the engine's existing cure/overclaim kill-list (constants.ts) and adds a
// medical-promise list for this medical-adjacent niche. Pure + dependency-free so
// it can run anywhere (pipeline stages, tests) and be unit-tested without a DB.

import { BANNED_WORDS, SOFTEN_WORDS } from "./constants";

// Condition-as-promise / regulated terms. Editable — kept here so there's one
// obvious place to extend it (and a future SOP override can replace it).
export const MEDICAL_CLAIM_TERMS = [
  "treat",
  "treats",
  "heal",
  "heals",
  "cure",
  "cures",
  "cured",
  "reverse",
  "reverses",
  "prevent",
  "prevents",
  "clinically proven",
  "fda approved",
  "fda-approved",
  "medical grade",
  "medical-grade",
  "doctor recommended",
  "therapeutic",
  "diagnose",
] as const;

export type ClaimFlagType = "cure" | "medical" | "soften";

export interface ClaimFlag {
  phrase: string;
  type: ClaimFlagType;
  snippet: string; // a little surrounding context, for the reviewer
}

export interface ClaimScan {
  status: "clean" | "warn" | "flagged";
  flags: ClaimFlag[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snippetAround(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - 32);
  const end = Math.min(text.length, index + matchLen + 32);
  const pre = start > 0 ? "…" : "";
  const post = end < text.length ? "…" : "";
  return (pre + text.slice(start, end).replace(/\s+/g, " ").trim() + post).slice(0, 160);
}

function scanList(
  text: string,
  list: readonly string[],
  type: ClaimFlagType,
  seen: Set<string>,
  out: ClaimFlag[],
): void {
  for (const phrase of list) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i");
    const m = re.exec(text);
    if (m) {
      seen.add(key);
      out.push({ phrase, type, snippet: snippetAround(text, m.index, m[0].length) });
    }
  }
}

/**
 * Scan arbitrary copy for compliance-relevant claims. Returns every distinct
 * phrase hit, classified: `cure` (hard overclaim) > `medical` (condition-as-
 * promise / regulated) > `soften` (soft overclaim). Status is the worst tier hit.
 */
export function scanClaims(text: string): ClaimScan {
  if (!text?.trim()) return { status: "clean", flags: [] };
  const flags: ClaimFlag[] = [];
  const seen = new Set<string>();
  scanList(text, BANNED_WORDS, "cure", seen, flags);
  scanList(text, MEDICAL_CLAIM_TERMS, "medical", seen, flags);
  scanList(text, SOFTEN_WORDS, "soften", seen, flags);

  const hasHard = flags.some((f) => f.type === "cure" || f.type === "medical");
  const status: ClaimScan["status"] = hasHard ? "flagged" : flags.length ? "warn" : "clean";
  return { status, flags };
}
