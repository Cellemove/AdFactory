"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { runAgent, extractJsonObject } from "@/lib/cellumove/agents";
import { filterNovel } from "@/lib/cellumove/novelty";
import { resolveAngle } from "@/lib/cellumove/angles";
import {
  VERBATIM_CATEGORIES,
  SOURCE_TYPES,
  computeSourceWeight,
  normalizeCategory,
  normalizeSourceType,
} from "@/lib/cellumove/verbatim-taxonomy";
import type { VerbatimRow } from "@/lib/database.types";

const MineSchema = z.object({
  angleSlug: z.string().optional().nullable(),
  subAvatarId: z.string().optional().nullable(),
  focus: z.string().optional().nullable(),
  market: z.string().optional().nullable(),
  platforms: z.array(z.string()).optional(),
  targetCount: z.number().int().min(4).max(60).optional(),
});

interface RawVerbatim {
  text: string;
  category: string;
  sourceType: string;
  sourceUrl?: string;
  engagementScore?: number;
}

function buildInstruction(): string {
  const cats = VERBATIM_CATEGORIES.map((c) => `  • ${c.slug} — ${c.description}`).join("\n");
  const srcs = SOURCE_TYPES.map((s) => `  • ${s.slug} (${s.label})`).join("\n");
  return [
    "You are the Researcher / Verbatim Miner. You capture what REAL PEOPLE say about a problem — in their own words — and classify each quote.",
    "You do NOT summarize or paraphrase into marketing language. Capture the actual sentence a real person wrote, verbatim, and tag it.",
    "",
    "SOURCE DISCIPLINE — capture real first-person voices only:",
    "  Use site-restricted Google searches: site:reddit.com, site:quora.com, site:youtube.com (comment threads),",
    "  site:trustpilot.com, site:amazon.* (reviews), site:mumsnet.com, site:patient.info, site:medhelp.org, and similar.",
    "  REJECT SEO listicles, brand blogs, press releases, and AI content-farm text. If a quote isn't a real person's words, drop it.",
    "  For EACH verbatim, capture its engagement (likes / upvotes / replies) as an integer — this weights relevance. A 500-like comment outweighs an isolated one.",
    "",
    "CLASSIFY each verbatim into exactly one category:",
    cats,
    "",
    "TAG each with its source type (closest match):",
    srcs,
    "",
    'Return ONLY JSON: {"verbatims":[{"text","category","sourceType","sourceUrl","engagementScore"}]}',
    "  text = the quote verbatim. category = one slug above. sourceType = one slug above.",
    "  sourceUrl = the page it came from. engagementScore = integer (0 if unknown).",
    "Capture a spread across categories — not 20 pain quotes and nothing else. Prefer high-engagement, specific, concrete quotes.",
  ].join("\n");
}

// Existing verbatim texts in the same scope, for dedup. Scoped tightly (sub-avatar
// → angle) since that's where re-mining repeats; capped for performance. Fail-soft.
async function loadExistingVerbatimTexts(scope: {
  subAvatarId?: string | null;
  angleSlug?: string | null;
}): Promise<string[]> {
  try {
    let q = supabase.from("Verbatim").select("text");
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
  const context = [
    angleName ? `ANGLE: ${angleName}${angleSlug ? ` (${angleSlug})` : ""}` : "TOPIC: (open)",
    mechanism ? `Problem mechanism: ${mechanism}` : "",
    input.focus ? `FOCUS (desire / niche / product): ${input.focus}` : "",
    input.market ? `MARKET: ${input.market}` : "",
    input.platforms?.length ? `PRIORITIZE these source types: ${input.platforms.join(", ")}` : "",
    "",
    `Mine ~${target} verbatims. Search now, classify each, capture engagement + source URL.`,
    "Return ONLY the JSON object described in the system prompt.",
  ].filter(Boolean).join("\n");

  const text = await runAgent({
    role: "researcher",
    instruction: buildInstruction(),
    context,
    marketCode: input.market ?? null,
    grounded: true,
    feature: "verbatim_mining",
    metadata: { angleSlug, subAvatarId: input.subAvatarId ?? undefined },
    maxOutputTokens: 32768,
    thinkingBudget: 4096,
  });

  const parsed = extractJsonObject<{ verbatims?: RawVerbatim[] }>(text);
  if (!Array.isArray(parsed.verbatims) || parsed.verbatims.length === 0) {
    throw new Error("Mining returned no verbatims — try again or add focus.");
  }

  const now = new Date().toISOString();
  const rows = parsed.verbatims
    .filter((v) => v?.text?.trim())
    .map((v) => {
      const category = normalizeCategory(v.category);
      const sourceType = normalizeSourceType(v.sourceType);
      const engagementScore = Math.max(0, Math.round(Number(v.engagementScore) || 0));
      return {
        id: newId(),
        angleSlug,
        subAvatarId: input.subAvatarId ?? null,
        category,
        text: v.text.trim(),
        sourceType,
        sourceUrl: v.sourceUrl?.trim() || null,
        engagementScore,
        sourceWeight: computeSourceWeight(sourceType, engagementScore),
        market: input.market ?? null,
        researchId: null,
        createdAt: now,
      };
    });

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
  return { count: novel.length, duplicatesSkipped: dropped.length };
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
  let q = supabase.from("Verbatim").select("*");
  if (filter.angleSlug) q = q.eq("angleSlug", filter.angleSlug);
  if (filter.category) q = q.eq("category", filter.category);
  const res = await q.order("sourceWeight", { ascending: false }).limit(filter.limit ?? 200);
  return res.error ? [] : ((res.data ?? []) as VerbatimRow[]);
}
