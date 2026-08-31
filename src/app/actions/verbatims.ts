"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { filterNovel } from "@/lib/cellumove/novelty";
import { resolveAngle } from "@/lib/cellumove/angles";
import { fetchYouTubeThreads } from "@/lib/youtube";
import { buildVerifiedVerbatimQueries, verifiedCandidatesFromYouTube } from "@/lib/cellumove/verified-verbatims";
import type { VerbatimRow } from "@/lib/database.types";

const MineSchema = z.object({
  angleSlug: z.string().optional().nullable(),
  subAvatarId: z.string().optional().nullable(),
  focus: z.string().optional().nullable(),
  market: z.string().optional().nullable(),
  platforms: z.array(z.string()).optional(),
  targetCount: z.number().int().min(4).max(60).optional(),
});

// Existing verbatim texts in the same scope, for dedup. Scoped tightly (sub-avatar
// → angle) since that's where re-mining repeats; capped for performance. Fail-soft.
async function loadExistingVerbatimTexts(scope: {
  subAvatarId?: string | null;
  angleSlug?: string | null;
}): Promise<string[]> {
  try {
    let q = supabase.from("Verbatim").select("text").like("researchId", "verified:%");
    if (scope.subAvatarId) q = q.eq("subAvatarId", scope.subAvatarId);
    else if (scope.angleSlug) q = q.eq("angleSlug", scope.angleSlug);
    const res = await q.order("createdAt", { ascending: false }).limit(1000);
    if (res.error) return [];
    return ((res.data ?? []) as { text: string }[]).map((r) => r.text).filter(Boolean);
  } catch {
    return [];
  }
}

export async function mineVerbatims(rawInput: z.infer<typeof MineSchema>) {
  const input = MineSchema.parse(rawInput);

  // Resolve the angle — from the sub-avatar if given, else the slug.
  let angleSlug = input.angleSlug ?? null;
  let subAngleId: string | null = null;
  if (input.subAvatarId) {
    const sub = unwrapOpt(
      await supabase.from("SubAvatar").select("angleId").eq("id", input.subAvatarId).maybeSingle(),
    ) as { angleId: string } | null;
    if (sub) subAngleId = sub.angleId;
  }
  let angleName = angleSlug ?? "";
  let mechanism = "";
  if (subAngleId) {
    const a = unwrapOpt(
      await supabase.from("Angle").select("slug,name,mechanism").eq("id", subAngleId).maybeSingle(),
    ) as { slug: string; name: string; mechanism: string } | null;
    if (a) { angleSlug = a.slug; angleName = a.name; mechanism = a.mechanism; }
  } else if (angleSlug) {
    const resolved = resolveAngle(angleSlug);
    if (resolved) { angleName = resolved.name; mechanism = resolved.mechanism; }
    else {
      const a = unwrapOpt(
        await supabase.from("Angle").select("name,mechanism").eq("slug", angleSlug).maybeSingle(),
      ) as { name: string; mechanism: string } | null;
      if (a) { angleName = a.name; mechanism = a.mechanism; }
    }
  }

  const target = input.targetCount ?? 24;
  if (!angleName) throw new Error("Choose an angle or sub-avatar before mining.");
  const threads = await fetchYouTubeThreads(
    buildVerifiedVerbatimQueries({ angleName, mechanism, focus: input.focus }),
    { maxVideos: 12, maxComments: 50 },
  );
  if (threads.length === 0) {
    throw new Error("No directly verifiable YouTube comments were returned. Check the YouTube API key/quota or refine the focus.");
  }
  const now = new Date().toISOString();
  const rows = verifiedCandidatesFromYouTube({
    threads,
    angleSlug,
    subAvatarId: input.subAvatarId,
    market: input.market,
  })
    .sort((a, b) => b.sourceWeight - a.sourceWeight)
    .slice(0, target)
    .map(({ sourceAuthor: _sourceAuthor, sourcePublishedAt: _sourcePublishedAt, sourceFingerprint: _sourceFingerprint, ...v }) => ({
      ...v,
      id: newId(),
      createdAt: now,
    }));

  if (rows.length === 0) {
    throw new Error("Sources loaded, but no specific first-person customer comments passed the quality gate. Refine the angle or focus.");
  }

  // Dedup against the existing corpus so re-mining doesn't pile up the same quotes.
  // Lexical near-exact only (high threshold): we keep DISTINCT quotes even when the
  // sentiment is similar — semantic dedup would wrongly merge different verbatims.
  const existingTexts = await loadExistingVerbatimTexts({ subAvatarId: input.subAvatarId, angleSlug });
  const { novel, dropped } = filterNovel(rows, existingTexts, (r) => r.text, 0.85);

  if (novel.length > 0) {
    const ins = await supabase.from("Verbatim").insert(novel);
    if (ins.error) throw new Error(ins.error.message);
  }

  revalidatePath("/verbatims");
  return { count: novel.length, duplicatesSkipped: dropped.length, rejectedByQuality: threads.reduce((n, t) => n + t.comments.length, 0) - rows.length };
}

export async function deleteVerbatim(id: string) {
  const { error } = await supabase.from("Verbatim").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/verbatims");
}

export async function clearVerbatims(filter: { angleSlug?: string | null; subAvatarId?: string | null }) {
  let q = supabase.from("Verbatim").delete();
  if (filter.subAvatarId) q = q.eq("subAvatarId", filter.subAvatarId);
  else if (filter.angleSlug) q = q.eq("angleSlug", filter.angleSlug);
  else throw new Error("Refusing to clear the entire corpus without a filter.");
  const { error } = await q;
  if (error) throw new Error(error.message);
  revalidatePath("/verbatims");
}

// Used by the page to load a filtered, weight-sorted slice of the corpus.
export async function listVerbatims(filter: {
  angleSlug?: string | null;
  category?: string | null;
  limit?: number;
}): Promise<VerbatimRow[]> {
  let q = supabase.from("Verbatim").select("*").like("researchId", "verified:%");
  if (filter.angleSlug) q = q.eq("angleSlug", filter.angleSlug);
  if (filter.category) q = q.eq("category", filter.category);
  const res = await q.order("sourceWeight", { ascending: false }).limit(filter.limit ?? 200);
  return res.error ? [] : ((res.data ?? []) as VerbatimRow[]);
}
