// Parses a script's own timestamp headers into gold-baseline beats, so coding a
// winner starts from the structure already in the script instead of hand-copied
// quotes. Handles headers like:
//   0:00 à 0:05 · Hook
//   0:17 à 0:24 · DAY 1
//   1:04 - 1:10 — Guarantee
// A beat's quote is sliced VERBATIM from the script between headers (then edge-
// trimmed), so the gold-set "exact substring" rule holds by construction.

export interface ParsedScriptBeat {
  startSec: number;
  endSec: number;
  label: string;
  quote: string;
}

export interface ScriptFormatNormalization {
  scriptText: string;
  detectedHeaderCount: number;
  changedHeaderCount: number;
}

const HEADER_RE = /^[ \t]*(\d{1,2}):(\d{2})[ \t]*(?:à|a|-|–|—|to|→)[ \t]*(\d{1,2}):(\d{2})[ \t]*(?:[·•\-–—:][ \t]*)?(.*)$/i;
const PARENTHESIZED_HEADER_RE = /^[ \t]*(.+?)[ \t]*\([ \t]*(\d{1,2}):(\d{2})[ \t]*(?:à|a|-|–|—|to|→)[ \t]*(\d{1,2}):(\d{2})[ \t]*\)(?:[ \t]+(.*))?$/i;
const BARE_PARENTHESIZED_HEADER_RE = /^[ \t]*\([ \t]*(\d{1,2}):(\d{2})[ \t]*(?:à|a|-|–|—|to|→)[ \t]*(\d{1,2}):(\d{2})[ \t]*\)[ \t]*$/i;

export function normalizeScriptTimestampFormat(scriptText: string): ScriptFormatNormalization {
  const newline = scriptText.includes("\r\n") ? "\r\n" : "\n";
  let detectedHeaderCount = 0;
  let changedHeaderCount = 0;
  const lines = scriptText.split(/\r?\n/).map((line) => {
    const leadingMatch = HEADER_RE.exec(line);
    const parenthesizedMatch = PARENTHESIZED_HEADER_RE.exec(line);
    const bareParenthesizedMatch = BARE_PARENTHESIZED_HEADER_RE.exec(line);
    if (!leadingMatch && !parenthesizedMatch && !bareParenthesizedMatch) return line;

    detectedHeaderCount += 1;
    const startMinutes = Number(leadingMatch?.[1] ?? parenthesizedMatch?.[2] ?? bareParenthesizedMatch?.[1]);
    const startSeconds = Number(leadingMatch?.[2] ?? parenthesizedMatch?.[3] ?? bareParenthesizedMatch?.[2]);
    const endMinutes = Number(leadingMatch?.[3] ?? parenthesizedMatch?.[4] ?? bareParenthesizedMatch?.[3]);
    const endSeconds = Number(leadingMatch?.[4] ?? parenthesizedMatch?.[5] ?? bareParenthesizedMatch?.[4]);
    const rawLabel = leadingMatch
      ? (leadingMatch[5] ?? "").trim()
      : parenthesizedMatch
        ? (parenthesizedMatch[1] ?? "").replace(/^#+[ \t]*/, "").trim()
        : "";
    const trailingNote = (parenthesizedMatch?.[6] ?? "").trim();
    const label = trailingNote ? `${rawLabel} — ${trailingNote}` : rawLabel;
    const normalized = `${formatTimestamp(startMinutes * 60 + startSeconds)} – ${formatTimestamp(endMinutes * 60 + endSeconds)}${label ? ` · ${label}` : ""}`;
    if (normalized !== line) changedHeaderCount += 1;
    return normalized;
  });

  return {
    scriptText: lines.join(newline),
    detectedHeaderCount,
    changedHeaderCount,
  };
}

function formatTimestamp(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function parseScriptTimestampBeats(scriptText: string): ParsedScriptBeat[] {
  const lines = scriptText.split("\n");
  // Character offset of each line's start, so section slices stay verbatim
  // substrings of the original text.
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const headers: Array<{
    startSec: number;
    endSec: number;
    label: string;
    inlineQuote: string | null;
    lineIndex: number;
  }> = [];
  lines.forEach((line, lineIndex) => {
    const leadingMatch = HEADER_RE.exec(line);
    const parenthesizedMatch = PARENTHESIZED_HEADER_RE.exec(line);
    const bareParenthesizedMatch = BARE_PARENTHESIZED_HEADER_RE.exec(line);
    if (!leadingMatch && !parenthesizedMatch && !bareParenthesizedMatch) return;

    const startMinutes = Number(leadingMatch?.[1] ?? parenthesizedMatch?.[2] ?? bareParenthesizedMatch?.[1]);
    const startSeconds = Number(leadingMatch?.[2] ?? parenthesizedMatch?.[3] ?? bareParenthesizedMatch?.[2]);
    const endMinutes = Number(leadingMatch?.[3] ?? parenthesizedMatch?.[4] ?? bareParenthesizedMatch?.[3]);
    const endSeconds = Number(leadingMatch?.[4] ?? parenthesizedMatch?.[5] ?? bareParenthesizedMatch?.[4]);
    const remainder = leadingMatch
      ? (leadingMatch[5] ?? "").trim()
      : parenthesizedMatch
        ? (parenthesizedMatch[1] ?? "").replace(/^#+[ \t]*/, "").trim()
        : "";
    // Milanote/PDF extraction often flattens the section heading, direction,
    // dialogue, and overlays onto one line. In that format the remainder is
    // the beat quote; looking only below the header incorrectly yields blanks.
    // Parenthesized ranges follow a label ("BEAT 1 ... (0:07 - 0:20)"), so
    // their remainder is always a label and their quote starts on the next line.
    const inlineQuote = leadingMatch && (/["“”]/.test(remainder) || remainder.length >= 80)
      ? remainder
      : null;
    const label = inlineQuote
      ? inlineQuote.slice(0, firstLabelBoundary(inlineQuote)).trim()
      : remainder;
    headers.push({
      startSec: startMinutes * 60 + startSeconds,
      endSec: endMinutes * 60 + endSeconds,
      label,
      inlineQuote,
      lineIndex,
    });
  });

  return headers.flatMap((header, index) => {
    let quote = header.inlineQuote;
    if (!quote) {
      const contentStart = offsets[header.lineIndex]! + lines[header.lineIndex]!.length + 1;
      const next = headers[index + 1];
      const contentEnd = next ? offsets[next.lineIndex]! : scriptText.length;
      if (contentStart >= contentEnd) return [];
      quote = scriptText.slice(contentStart, contentEnd).trim();
    }
    if (!quote) return [];
    return [{ startSec: header.startSec, endSec: header.endSec, label: header.label, quote }];
  });
}

function firstLabelBoundary(value: string): number {
  const quoteIndex = value.search(/["“”]/);
  const sentenceIndex = value.search(/[.!?](?:["“”]|\s|$)/);
  const indexes = [quoteIndex, sentenceIndex].filter((index) => index > 0);
  return indexes.length ? Math.min(...indexes) : Math.min(value.length, 100);
}

// Ordered keyword → taxonomy-code guesses (French + English). First hit wins;
// a guess is only used when the code exists in the loaded taxonomy.
const CODE_GUESSES: Array<[RegExp, string]> = [
  [/r[eé]attribution|wrong reason|only reason/i, "B_REATTRIBUTION"],
  [/n[eé]gation|negation|myth|mensonge/i, "B_MYTH_BUST"],
  [/skeptic|scepti|doute|inocul|objection/i, "B_SKEPTICISM_INOCULATION"],
  [/alternative|categor|cat[eé]gorie|menu|refusal/i, "B_FAILED_ALTERNATIVES"],
  [/amplification|agitation|sympt[oô]me|symptom/i, "P_AGITATION"],
  [/douleur|\bpain\b/i, "P_HYPER_DATED"],
  [/time ladder|[eé]chelle|day|jour|week|semaine|palier/i, "PR_TIME_LADDER"],
  [/witness|t[eé]moin|sister|s[oœ]ur|husband|mari/i, "PR_WITNESS"],
  [/before|after|avant|apr[eè]s/i, "PR_BEFORE_AFTER"],
  [/preuve|proof|footage|customers?|client|\bdemo(?:nstration)?\b/i, "PR_RAW_CUSTOMER"],
  [/trustpilot|avis|review|social proof/i, "PR_SOCIAL_NUMBERS"],
  [/m[eé]canisme|mechanism|ridges|zones/i, "M_QUANTIFIED"],
  [/garantie|guarantee|risk/i, "O_GUARANTEE"],
  [/offre|offer|\bdeal\b|bogo|prix|price/i, "O_REASON_WHY"],
  [/\bcta\b|call to action/i, "O_CTA"],
  [/hook|accroche|ouverture/i, "H_OPENING"],
  [/question/i, "Q_QUESTION"],
];

// Heading matches remain authoritative. These narrower signals are consulted
// only when the heading itself is ambiguous, and always inspect the complete
// beat quote rather than assigning from its order alone.
const CONTEXT_CODE_GUESSES: Array<[RegExp, string]> = [
  [/\b(?:tap|click) below\b|\bshop now\b|\border now\b|\bget yours\b|\bgo find out\b/i, "O_CTA"],
  [/refund|money back|full refund|guarantee|\b(?:30|60|90|ninety) days?\b|buy one.{0,20}get one|(?:theirs|ours|price|cost).{0,25}(?:\$|£|€)\s*\d+/i, "O_GUARANTEE"],
  [/blood flow|blood (?:isn't|is not) reaching|circulation|how (?:it|this) works?|3d ridges?|press(?:es)? and release|contact points?|mechanism/i, "M_QUANTIFIED"],
  [/before and after|results?|testimonial|customer footage|unbroken take|\b(?:lost|gained)\s+\d+|week \d+|day \d+|husband|wife|sister|comments? (?:said|asked)/i, "PR_RAW_CUSTOMER"],
  [/surgery|cut\s+(?:\w+\s+){0,3}off|failed|scamm|changing room|rolled at (?:the |your )?waist|tried everything|pain|ache|swollen|heavy legs?|frustrat|embarrass|problem/i, "P_AGITATION"],
  [/\bwhat (?:if|happens|would)|\bwhy (?:does|do|is)|\bhow (?:can|do|does)|\?\s*$/i, "Q_QUESTION"],
  [/feel(?:s|ing)? (?:lighter|better|supported)|comfortable|relief|holds? everything|desired result|benefit/i, "B_BENEFIT"],
];

// The active taxonomy version may only carry each layer's generic code (e.g.
// copy-taxonomy-v1 has P_PROBLEM but not P_AGITATION). When the specific guess
// is absent, degrade to the same layer's generic code rather than OTHER.
const LAYER_FALLBACKS: Record<string, string[]> = {
  H: ["H_OPENING"],
  Q: ["Q_QUESTION"],
  P: ["P_PROBLEM"],
  B: ["B_BENEFIT"],
  M: ["M_MECHANISM"],
  PR: ["PR_PROOF"],
  O: ["O_OFFER", "O_CTA"],
};

const CODE_FALLBACKS: Record<string, string[]> = {
  B_MYTH_BUST: ["PR_PROOF"],
  B_SKEPTICISM_INOCULATION: ["PR_PROOF"],
  B_FAILED_ALTERNATIVES: ["PR_PROOF"],
};

function resolveCode(target: string, availableCodes: ReadonlySet<string>): string | null {
  if (availableCodes.has(target)) return target;
  for (const fallback of CODE_FALLBACKS[target] ?? []) {
    if (availableCodes.has(fallback)) return fallback;
  }
  const layer = target.split("_")[0]!;
  for (const fallback of LAYER_FALLBACKS[layer] ?? []) {
    if (availableCodes.has(fallback)) return fallback;
  }
  for (const code of availableCodes) if (code.startsWith(`${layer}_`)) return code;
  return null;
}

export function guessTaxonomyCode(
  label: string,
  index: number,
  availableCodes: ReadonlySet<string>,
  context?: { quote?: string; startSec?: number },
): { code: string; otherExplanation: string | null } {
  for (const [pattern, code] of CODE_GUESSES) {
    if (!pattern.test(label)) continue;
    const resolved = resolveCode(code, availableCodes);
    if (resolved) return { code: resolved, otherExplanation: null };
  }
  const quote = context?.quote?.trim() ?? "";
  for (const [pattern, code] of CONTEXT_CODE_GUESSES) {
    if (!pattern.test(quote)) continue;
    const resolved = resolveCode(code, availableCodes);
    if (resolved) return { code: resolved, otherExplanation: null };
  }
  const opening = resolveCode("H_OPENING", availableCodes);
  if (
    index === 0 &&
    opening &&
    (!label.trim() || context?.startSec === 0 || /hook|accroche|ouverture/i.test(label))
  ) {
    return { code: opening, otherExplanation: null };
  }
  return { code: "OTHER", otherExplanation: label ? `Unmapped section: ${label}` : "Unmapped section" };
}
