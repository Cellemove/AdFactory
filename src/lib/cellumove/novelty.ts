// Shared novelty / anti-repetition toolkit.
//
// Generation is stateless, so every generator regresses to the same obvious
// output. This module gives each one two tools: an EXCLUSION BLOCK to paste into
// the prompt ("here's what we already have — make something different"), and a
// lexical DEDUP GATE to drop near-duplicates the model produces anyway.
//
// Pure + dependency-free (no DB) so it's reusable everywhere and unit-testable.
// Semantic dedup (embeddings) is a later upgrade; this is the lexical Phase 1.

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((w) => w.length > 2));
}

/** Word-set Jaccard similarity (0..1) — tolerant of reordering and punctuation. */
export function similarity(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** True if `candidate` is a near-duplicate of anything in `existing`. */
export function isNearDuplicate(candidate: string, existing: Iterable<string>, threshold = 0.72): boolean {
  const c = norm(candidate);
  if (!c) return false;
  for (const e of existing) {
    const en = norm(e);
    if (!en) continue;
    // Containment only for longer strings, to avoid short-name false positives.
    // Gate it on the length ratio so a long SUPERSET with lots of new content isn't
    // dropped as a "duplicate" of a shorter substring (it's genuinely more info).
    if (c.length > 24 && en.length > 24 && (en.includes(c) || c.includes(en))) {
      const shorter = Math.min(c.length, en.length);
      const longer = Math.max(c.length, en.length);
      if (shorter / longer >= threshold) return true;
    }
    if (similarity(candidate, e) >= threshold) return true;
  }
  return false;
}

/**
 * Split candidates into novel vs dropped (near-duplicate), checking against the
 * existing set AND earlier-kept candidates (so the batch is internally distinct).
 */
export function filterNovel<T>(
  items: T[],
  existing: string[],
  textOf: (t: T) => string,
  threshold = 0.72,
): { novel: T[]; dropped: T[] } {
  const novel: T[] = [];
  const dropped: T[] = [];
  const seen = [...existing];
  for (const it of items) {
    const text = textOf(it);
    if (text.trim() && isNearDuplicate(text, seen, threshold)) {
      dropped.push(it);
    } else {
      novel.push(it);
      if (text.trim()) seen.push(text);
    }
  }
  return { novel, dropped };
}

/** Format a "DO NOT REPEAT" exclusion block for a prompt. "" when no items. */
export function exclusionBlock(title: string, instruction: string, items: string[], max = 50): string {
  const clean = [...new Set(items.map((s) => s.trim()).filter(Boolean))].slice(0, max);
  if (clean.length === 0) return "";
  return [
    "",
    "════════════════════════════════════════════════════════════════════════",
    title,
    "════════════════════════════════════════════════════════════════════════",
    instruction,
    ...clean.map((s) => `  - ${s}`),
  ].join("\n");
}
