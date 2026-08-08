"use server";

import { revalidatePath } from "next/cache";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { gatherRedditVerbatims } from "@/lib/reddit";
import { gatherYouTubeComments } from "@/lib/youtube";
import { subredditsForAngle, renderSubredditBlock } from "@/lib/cellumove/subreddits";
import { extractJsonObject } from "@/lib/cellumove/agents";
import { DEEP_DIVE_TEMPLATE } from "@/lib/cellumove/deep-dive-template";
import { CLAIMS_GUARDRAIL } from "@/lib/cellumove/pipeline-stages";
import { verifyDraft } from "@/lib/cellumove/verify-research";
import { dedupeNovel } from "@/lib/cellumove/embeddings";
import { exclusionBlock } from "@/lib/cellumove/novelty";
import { personaNoveltyItems } from "@/lib/cellumove/novelty-sources";
import { saveResearchedSubAvatar, type ResearchedAvatarDraft } from "./research";
import { createPipelineRun } from "./pipeline-run";
import type { ResearchRow } from "@/lib/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

// The angle the excavation derives from the (desire, problem) seed. CelluMove's
// product is fixed (compression leggings), so the "angle" is really the problem
// cluster + the mechanism compression owns for it.
export interface ExcavationAngleSpec {
  name: string;
  slug: string;
  mechanism: string;
  requiredKeyword: string;
  bannedMechanism: string;
}

// A sub-avatar is a ResearchedAvatarDraft (so it drops straight into the existing
// save + pipeline flow) plus a few excavation-only framing fields.
export interface ExcavatedSubAvatar extends ResearchedAvatarDraft {
  distinctFrom: string;   // how this persona differs from the others
  surfaceDesire: string;  // the surface want, in her words
  coreProblem: string;    // the underlying problem she's really fighting
}

export interface ExcavationResult {
  id: string;
  avatarName: string;      // the vivid name of the overarching avatar
  avatarSummary: string;   // 1-2 sentences on who she is
  angle: ExcavationAngleSpec;
  subAvatars: ExcavatedSubAvatar[];
  sources: string[];       // top overall sources
  surfaceDesire: string;   // the seed inputs, echoed back
  problem: string;
  createdAt: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const EXCAVATION_SYSTEM_PROMPT = [
  "You are a world-class creative strategist AND customer-research analyst for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche (brand: CelluMove).",
  "You are given ONE surface desire and ONE problem the customer encounters. Your mission: do a deep, grounded verbatim scrape across the real internet, then map the WHOLE avatar — name the overarching avatar and break her into every distinct sub-avatar you can defend with evidence.",
  "This is the FIRST STEP (Avatar Excavation). A later step deep-dives whichever sub-avatar the user picks — so your job here is breadth + real grounding, enough that the user can confidently choose one.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "SOURCE DISCIPLINE — non-negotiable (mine RAW VERBATIMS, not marketing copy)",
  "════════════════════════════════════════════════════════════════════════",
  "Gather real first-person voice across ALL of these, not just one:",
  "  • site:reddit.com (threads + full comment sections)",
  "  • site:youtube.com (top comments on relevant videos — real comments are provided below; quote them)",
  "  • site:tiktok.com/@<creator> (captions + top comments)",
  "  • site:quora.com (long personal answers)",
  "  • Amazon reviews & Q&A for competitor compression/shaping products (5-star transformations, 1-star frustrations)",
  "  • site:facebook.com/groups, and niche forums (patient.info, mumsnet.com, netmums.com, medhelp.org)",
  "Run 8-12 distinct grounded queries. Mix the desire/problem with: \"reddit\", \"what helps\", \"tried everything\", \"finally\", \"anyone else\", \"my experience\", \"i'm so tired of\", \"before and after\".",
  "READ IN FULL — after searching, OPEN the most promising URLs with url-context and read the ENTIRE thread/page (post + replies + comments) before drafting. Snippets lie; the gold is in the back-and-forth.",
  "REJECT and never cite: SEO listicles, brand blogs, affiliate roundups, press releases, AI content farms, or anything that doesn't quote a real person in their own words.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "VERBATIM RULE — quote real people, never invent",
  "════════════════════════════════════════════════════════════════════════",
  "Every pain point / desire / trigger you write must be grounded in something a real person actually wrote. Use their EXACT phrasing in quotation marks where possible.",
  "Do NOT paraphrase into marketing language, and do NOT fabricate quotes, threads, or URLs. If you can't ground a sub-avatar in at least 3 real-people sources, drop it.",
  "Every sub-avatar must cite AT LEAST 3 real source URLs.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "HOW TO BUILD THE AVATAR + SUB-AVATARS",
  "════════════════════════════════════════════════════════════════════════",
  "1. From the raw verbatims, identify the OVERARCHING avatar this desire+problem belongs to. Give her a vivid, human name (e.g. 'The End-of-Day Desk Professional', 'The Post-Baby Body Rebuilder').",
  "2. Break her into 4-7 DISTINCT sub-avatars. Distinct = different life stage, context, trigger moment, body relationship, or core value driver — NOT three variants of one person.",
  "3. For each sub-avatar, fill every field from REAL research in HER words (pain, desires, objections, daily language, triggers, identity, social proof, buying context).",
  "4. Derive the ANGLE this avatar maps to: the mechanism compression legitimately owns for this problem, the one keyword that must appear in every prompt, and the mechanisms from OTHER angles to avoid.",
  "",
  CLAIMS_GUARDRAIL,
  "",
  "════════════════════════════════════════════════════════════════════════",
  "OUTPUT — return EXACTLY one JSON object, no prose, no markdown fences",
  "════════════════════════════════════════════════════════════════════════",
  `{
  "avatarName": "vivid name of the overarching avatar",
  "avatarSummary": "1-2 sentence summary of who she is and what unites the sub-avatars",
  "angle": {
    "name": "Title Case angle name (2-4 words)",
    "slug": "kebab-case-slug",
    "mechanism": "the physiological/lifestyle mechanism compression owns for this problem",
    "requiredKeyword": "1 word that must appear in every prompt for this angle",
    "bannedMechanism": "pipe|separated|mechanisms from other angles that would dilute this one"
  },
  "subAvatars": [
    {
      "name": "3-6 word persona descriptor",
      "shortDesc": "1-sentence summary of who she is",
      "distinctFrom": "how this persona differs from the other sub-avatars",
      "surfaceDesire": "the surface want in her words",
      "coreProblem": "the deeper problem she's really fighting",
      "painPoints": "newline-separated bullets, real phrasing with short direct quotes",
      "desires": "newline-separated bullets",
      "objections": "newline-separated bullets — reasons NOT to buy",
      "dailyLanguage": "newline-separated exact phrases she uses",
      "triggers": "newline-separated buying-trigger moments (include visual cues / trigger moments)",
      "identity": "1-2 sentences on how she sees herself / wants to be seen",
      "socialProof": "what proof would land (peer testimonials, doctor mentions, before/afters)",
      "buyingContext": "where, when, how she shops for this",
      "sources": ["https://reddit.com/...", "https://youtube.com/...", "https://..."]
    }
  ],
  "sources": ["the top overall source URLs across the whole excavation"]
}`,
  "",
  "════════════════════════════════════════════════════════════════════════",
  "DEPTH & QUALITY BAR — research to this standard before you draft",
  "════════════════════════════════════════════════════════════════════════",
  DEEP_DIVE_TEMPLATE,
].join("\n");

// ─── Actions ────────────────────────────────────────────────────────────────

export async function excavateAvatar(input: {
  surfaceDesire: string;
  problem: string;
}): Promise<ExcavationResult> {
  const surfaceDesire = input.surfaceDesire?.trim() ?? "";
  const problem = input.problem?.trim() ?? "";
  if (!surfaceDesire && !problem) {
    throw new Error("Enter at least a surface desire or a problem to excavate.");
  }

  const llm = getLLM();
  const seed = [problem, surfaceDesire].filter(Boolean).join(" ");
  const subs = subredditsForAngle({ focus: seed });

  // Scrape raw verbatims (Reddit + YouTube) AND load the cross-run novelty pool in
  // parallel. The pool = every persona we've already produced (saved sub-avatars +
  // prior excavations), so we stop handing back the same obvious avatar each run.
  const [reddit, youtube, noveltyItems] = await Promise.all([
    gatherRedditVerbatims(
      [
        problem || surfaceDesire,
        surfaceDesire || problem,
        `${problem} what helps`,
        `${problem} tried everything`,
        `${surfaceDesire} finally`,
      ].filter(Boolean),
      { subreddits: subs },
    ),
    gatherYouTubeComments([problem, `${problem} review`, surfaceDesire].filter(Boolean)),
    personaNoveltyItems(),
  ]);

  const userPrompt = [
    "BRAND: CelluMove — 3D-shaping compression leggings with targeted compression zones for a smoother, sculpted, supported look.",
    "",
    `SURFACE DESIRE (seed): ${surfaceDesire || "(none given — infer from the problem)"}`,
    `PROBLEM THEY ENCOUNTER (seed): ${problem || "(none given — infer from the desire)"}`,
    "",
    "Search the web NOW. Do the deep verbatim scrape described in the system prompt across Reddit, YouTube, TikTok, Quora, Amazon reviews and forums.",
    "Then name the overarching avatar and break her into 4-7 distinct, evidence-backed sub-avatars, and derive the angle. Return ONLY the JSON object described in the system prompt.",
    "NOVELTY IS REQUIRED: every sub-avatar (and the overarching avatar name) must be GENUINELY DIFFERENT from the ones we've already mapped (listed below) and from each other. Do not re-surface, rename, or lightly reskin a persona we already have — find personas grounded in DIFFERENT life stages, contexts, trigger moments, body relationships, or value drivers.",
    exclusionBlock(
      "PERSONAS WE'VE ALREADY MAPPED — DO NOT REPEAT THESE",
      "These avatars/sub-avatars already exist from prior excavations and research. Each new sub-avatar must be clearly distinct from every one of these:",
      noveltyItems,
    ),
    renderSubredditBlock(subs),
    reddit.trim() ? `\nREAL REDDIT VERBATIMS — already fetched for you (quote these directly, with their URLs):\n${reddit}` : "",
    youtube.trim() ? `\nREAL YOUTUBE COMMENTS — already fetched for you (quote these directly, with their URLs):\n${youtube}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: EXCAVATION_SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: 49152,
      thinkingConfig: { thinkingBudget: 8192 },
    },
  });
  await recordUsage({
    feature: "avatar_excavation",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { surfaceDesire, problem },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Excavation returned no content — try again.");
  const raw = extractJsonObject<{
    avatarName?: string;
    avatarSummary?: string;
    angle?: Partial<ExcavationAngleSpec>;
    subAvatars?: Partial<ExcavatedSubAvatar>[];
    sources?: unknown;
  }>(text);

  const slugify = (s: string) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const angleName = raw.angle?.name?.trim() || raw.avatarName?.trim() || problem || surfaceDesire || "New Angle";
  const angle: ExcavationAngleSpec = {
    name: angleName,
    slug: slugify(raw.angle?.slug || angleName) || `angle-${newId().slice(0, 6)}`,
    mechanism: raw.angle?.mechanism?.trim() || `Targeted compression for: ${problem || surfaceDesire}`,
    requiredKeyword: (raw.angle?.requiredKeyword?.trim() || "compression").toLowerCase(),
    bannedMechanism: raw.angle?.bannedMechanism?.trim() || "",
  };

  const subAvatars: ExcavatedSubAvatar[] = (Array.isArray(raw.subAvatars) ? raw.subAvatars : []).map((d) => ({
    name: d.name ?? "",
    shortDesc: d.shortDesc ?? "",
    distinctFrom: d.distinctFrom ?? "",
    surfaceDesire: d.surfaceDesire ?? "",
    coreProblem: d.coreProblem ?? "",
    painPoints: d.painPoints ?? "",
    desires: d.desires ?? "",
    objections: d.objections ?? "",
    dailyLanguage: d.dailyLanguage ?? "",
    triggers: d.triggers ?? "",
    identity: d.identity ?? "",
    socialProof: d.socialProof ?? "",
    buyingContext: d.buyingContext ?? "",
    sources: Array.isArray(d.sources) ? d.sources.filter((s): s is string => typeof s === "string") : [],
    profile: null,
    verification: null,
  }));
  if (subAvatars.length === 0) throw new Error("Excavation found no sub-avatars — try a sharper problem/desire.");

  // Dedupe sub-avatars against the cross-run pool AND each other (lexical + semantic),
  // so a persona we've already produced is dropped even if the model repeats it.
  const deduped = await dedupeNovel(
    subAvatars,
    noveltyItems,
    (d) => `${d.name} ${d.shortDesc} ${d.coreProblem} ${d.painPoints}`,
  );

  // Anti-hallucination pass: confirm each sub-avatar's cited sources are live.
  await Promise.all(
    deduped.map(async (d) => {
      try {
        d.verification = await verifyDraft({ sources: d.sources, profile: null });
      } catch {
        d.verification = null;
      }
    }),
  );

  const id = newId();
  const result: ExcavationResult = {
    id,
    avatarName: raw.avatarName?.trim() || angleName,
    avatarSummary: raw.avatarSummary?.trim() || "",
    angle,
    subAvatars: deduped,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === "string") : [],
    surfaceDesire,
    problem,
    createdAt: new Date().toISOString(),
  };

  // Persist as a Research row (type "excavation") — zero-migration store.
  await supabase.from("Research").insert({
    id,
    type: "excavation",
    angleSlug: angle.slug,
    focus: result.avatarName,
    drafts: JSON.stringify(result),
    status: "pending",
    createdAt: result.createdAt,
  });
  revalidatePath("/excavate");
  return result;
}

// Ensure the derived angle exists (reuse by slug), returning its slug.
async function ensureAngle(spec: ExcavationAngleSpec): Promise<string> {
  const existing = unwrapOpt(
    await supabase.from("Angle").select("slug").eq("slug", spec.slug).maybeSingle(),
  ) as { slug: string } | null;
  if (existing) return existing.slug;

  const lastRes = await supabase.from("Angle").select("order").order("order", { ascending: false }).limit(1);
  const lastOrder = (lastRes.data?.[0]?.order as number | undefined) ?? 0;
  const now = new Date().toISOString();
  const ins = await supabase.from("Angle").insert({
    id: newId(),
    slug: spec.slug,
    name: spec.name,
    requiredKeyword: spec.requiredKeyword || spec.name.toLowerCase(),
    mechanism: spec.mechanism,
    bannedMechanism: spec.bannedMechanism ?? "",
    silhouette: "short-legging",
    colorway: "pink",
    order: lastOrder + 1,
    createdAt: now,
  });
  if (ins.error) throw new Error(ins.error.message);
  revalidatePath("/avatars");
  return spec.slug;
}

// Pick a sub-avatar from an excavation → save it + its angle → start a pipeline.
// The pipeline's first stage (G2) IS the deep dive, so this "deep dives the
// chosen sub-avatar" exactly as the flow intends.
export async function startDeepDiveFromExcavation(input: {
  excavationId: string;
  index: number;
}): Promise<{ runId: string }> {
  const row = unwrapOpt(
    await supabase.from("Research").select("*").eq("id", input.excavationId).eq("type", "excavation").maybeSingle(),
  ) as ResearchRow | null;
  if (!row) throw new Error("Excavation not found.");

  let parsed: ExcavationResult;
  try {
    parsed = JSON.parse(row.drafts) as ExcavationResult;
  } catch {
    throw new Error("Excavation data is corrupt — re-run the excavation.");
  }
  const sub = parsed.subAvatars?.[input.index];
  if (!sub) throw new Error("That sub-avatar no longer exists — re-run the excavation.");

  const angleSlug = await ensureAngle(parsed.angle);
  const { subAvatarId } = await saveResearchedSubAvatar({ angleSlug, draft: sub });
  const { runId } = await createPipelineRun(subAvatarId);
  return { runId };
}
