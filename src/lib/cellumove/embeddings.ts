// Semantic novelty (Phase 2) — embeddings-based dedup that catches "same idea,
// totally reworded" repeats the lexical pass (novelty.ts) misses.
//
// On-the-fly: we embed the existing items + the new candidates each call and drop
// candidates too close to anything existing (or to each other). No vector store /
// migration — at this app's scale (tens–hundreds of items) that's cheap and simple.
//
// FAILS SOFT: if embeddings aren't available (no creds, quota, API change), the
// dedupe helpers fall back to the lexical result so generation is never blocked.

import { getLLM, isLLMConfigured } from "@/lib/llm";
import { filterNovel } from "./novelty";

// Vertex text-embedding model. Overridable; text-embedding-004 is broadly available.
export const EMBED_MODEL = process.env.EMBED_MODEL?.trim() || "text-embedding-004";
const SIM_THRESHOLD = 0.9; // cosine >= this ⇒ semantic near-duplicate

/** Embed texts (batched, order-preserving). null on any failure — caller fails soft. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!isLLMConfigured()) return null;
  if (texts.length === 0) return [];
  const inputs = texts.map((t) => {
    const s = (t ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
    return s || " ";
  });
  try {
    const ai = getLLM();
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += 100) {
      const batch = inputs.slice(i, i + 100);
      const res = await ai.models.embedContent({ model: EMBED_MODEL, contents: batch });
      const embs = res.embeddings;
      if (!Array.isArray(embs) || embs.length !== batch.length) return null;
      for (const e of embs) out.push(e.values ?? []);
    }
    return out;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Drop candidates that are SEMANTICALLY too close to an existing item or to an
 * earlier-kept candidate. Returns null when embeddings are unavailable so the
 * caller can fall back to the lexical result.
 */
export async function filterNovelSemantic<T>(
  items: T[],
  existing: string[],
  textOf: (t: T) => string,
  threshold = SIM_THRESHOLD,
): Promise<{ novel: T[]; dropped: T[] } | null> {
  if (items.length === 0) return { novel: [], dropped: [] };
  const itemTexts = items.map(textOf);
  const embs = await embedTexts([...existing, ...itemTexts]);
  if (!embs) return null;
  const kept: number[][] = embs.slice(0, existing.length); // existing embeddings
  const itemEmbs = embs.slice(existing.length);

  const novel: T[] = [];
  const dropped: T[] = [];
  items.forEach((item, i) => {
    const e = itemEmbs[i] ?? [];
    const dup = kept.some((k) => cosine(e, k) >= threshold);
    if (dup) {
      dropped.push(item);
    } else {
      novel.push(item);
      kept.push(e); // keep distinct candidates apart from each other too
    }
  });
  return { novel, dropped };
}

/**
 * Full novelty gate: lexical pass (cheap, catches rewording) then semantic pass
 * (catches reworded-same-idea). Always returns a non-empty list when given items
 * — if both passes would empty it, the originals are returned rather than nothing.
 */
export async function dedupeNovel<T>(
  items: T[],
  existing: string[],
  textOf: (t: T) => string,
  threshold = SIM_THRESHOLD,
): Promise<T[]> {
  if (items.length === 0) return items;
  const lexical = filterNovel(items, existing, textOf).novel;
  const survivors = lexical.length ? lexical : items;
  const sem = await filterNovelSemantic(survivors, existing, textOf, threshold);
  const result = sem ? (sem.novel.length ? sem.novel : survivors) : survivors;
  return result.length ? result : items;
}
