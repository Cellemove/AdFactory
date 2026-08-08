// Cross-run novelty sources — the persisted "what we've already produced" pools
// that every persona generator excludes against (prompt) and dedupes against
// (embeddings). Centralised so cross-run novelty is consistent across the app:
// the excavation flow and the sub-avatar research flow share ONE pool, so neither
// keeps handing back the same obvious persona (e.g. "The On-Her-Feet Professional").
//
// Server-only (touches the DB). Every loader is fail-soft → [] so novelty is a
// best-effort default, never a hard dependency that can break generation.
import "server-only";
import { supabase } from "@/lib/db";

const clean = (s: string) => s.replace(/^\[AI\]\s*/, "").trim();

/** Saved sub-avatars as "Name — shortDesc" strings. Angle-scoped when angleId given. */
export async function savedSubAvatarItems(angleId?: string | null, limit = 120): Promise<string[]> {
  try {
    const base = supabase
      .from("SubAvatar")
      .select("name, shortDesc")
      .order("createdAt", { ascending: false })
      .limit(limit);
    const res = angleId ? await base.eq("angleId", angleId) : await base;
    const rows = (res.data ?? []) as { name: string; shortDesc: string | null }[];
    return rows.map((r) => `${clean(r.name)}${r.shortDesc ? ` — ${r.shortDesc}` : ""}`);
  } catch {
    return [];
  }
}

/** Sub-avatars (name + shortDesc) from prior excavations. Angle-scoped when slug given. */
export async function priorExcavationItems(angleSlug?: string | null, limit = 40): Promise<string[]> {
  try {
    const base = supabase
      .from("Research")
      .select("focus, drafts")
      .eq("type", "excavation")
      .order("createdAt", { ascending: false })
      .limit(limit);
    const res = angleSlug ? await base.eq("angleSlug", angleSlug) : await base;
    const rows = (res.data ?? []) as { focus: string | null; drafts: string }[];
    const items: string[] = [];
    for (const row of rows) {
      if (row.focus) items.push(clean(row.focus)); // the overarching avatar name
      try {
        const parsed = JSON.parse(row.drafts) as { subAvatars?: { name?: string; shortDesc?: string }[] };
        for (const s of parsed.subAvatars ?? []) {
          if (s?.name) items.push(`${clean(s.name)}${s.shortDesc ? ` — ${s.shortDesc}` : ""}`);
        }
      } catch {
        /* skip unparseable row */
      }
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * The combined persona novelty pool used by BOTH the excavation flow and the
 * sub-avatar research flow. Pass an angle to scope it (research); omit it to pool
 * everything we've ever produced (excavation, which derives its angle fresh).
 */
export async function personaNoveltyItems(
  angleSlug?: string | null,
  angleId?: string | null,
): Promise<string[]> {
  const [saved, excav] = await Promise.all([
    savedSubAvatarItems(angleId ?? null),
    priorExcavationItems(angleSlug ?? null),
  ]);
  return Array.from(new Set([...saved, ...excav]));
}
