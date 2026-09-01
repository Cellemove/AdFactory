"use server";

import { revalidatePath } from "next/cache";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { resolveAngle } from "@/lib/cellumove/angles";
import { gatherRedditVerbatims } from "@/lib/reddit";
import { DEEP_DIVE_TEMPLATE } from "@/lib/cellumove/deep-dive-template";
import { parseAvatarProfile, type AvatarProfile } from "@/lib/cellumove/avatar-profile";
import { verifyDraft, type DraftVerification } from "@/lib/cellumove/verify-research";
import { subredditsForAngle, renderSubredditBlock } from "@/lib/cellumove/subreddits";
import { exclusionBlock } from "@/lib/cellumove/novelty";
import { priorExcavationItems } from "@/lib/cellumove/novelty-sources";
import { dedupeNovel } from "@/lib/cellumove/embeddings";
import {
  deterministicResearchId,
  evaluateResearchQuality,
  normalizeEvidenceClaims,
  type ResearchEvidenceClaim,
  type ResearchQualityReport,
  type ResearchQueryPlan,
  type ResearchType,
} from "@/lib/cellumove/research-evidence";
import { planResearchQueries, queryPlanQueries, renderResearchQueryPlan } from "@/lib/cellumove/research-planner.server";
import {
  persistResearchLedger,
  renderRetrievedResearchEvidence,
  retrieveResearchEvidence,
  type LedgerDraft,
} from "@/lib/cellumove/research-ledger.server";
import type { SopRow } from "@/lib/database.types";

// The deep-dive section spec + quality bar the sub-avatar researcher follows.
// Prefers a runtime-editable `deep_dive_template` SOP (written in /knowledge);
// falls back to the built-in constant so research works before the DB is seeded.
async function loadDeepDiveTemplate(): Promise<string> {
  try {
    const res = await supabase
      .from("Sop")
      .select("*")
      .eq("type", "deep_dive_template")
      .order("pinned", { ascending: false })
      .order("order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (res.error) return DEEP_DIVE_TEMPLATE;
    const row = res.data as SopRow | null;
    return row?.body?.trim() ? row.body : DEEP_DIVE_TEMPLATE;
  } catch {
    return DEEP_DIVE_TEMPLATE;
  }
}

// The avatars we ALREADY own for this angle (as "Name — desc" strings), so the
// model can avoid them and we can dedupe against them. Stateless generation
// otherwise regresses to the same few obvious personas.
async function existingAvatarItems(angleSlug: string): Promise<string[]> {
  try {
    const angle = unwrapOpt(
      await supabase.from("Angle").select("id").eq("slug", angleSlug).maybeSingle(),
    ) as { id: string } | null;
    if (!angle) return [];
    const res = await supabase
      .from("SubAvatar")
      .select("name, shortDesc")
      .eq("angleId", angle.id)
      .order("createdAt", { ascending: false })
      .limit(40);
    const rows = (res.data ?? []) as { name: string; shortDesc: string | null }[];
    return rows.map((r) => `${r.name.replace(/^\[AI\]\s*/, "")}${r.shortDesc ? ` — ${r.shortDesc}` : ""}`);
  } catch {
    return [];
  }
}

// Wraps fetched Reddit comments in a labelled block for the prompt. Returns "" when
// nothing came back, so callers can append unconditionally.
function redditBlock(verbatims: string): string {
  if (!verbatims.trim()) return "";
  return [
    "",
    "════════════════════════════════════════════════════════════════════════",
    "REAL REDDIT VERBATIMS — already fetched in full for you (use these directly)",
    "════════════════════════════════════════════════════════════════════════",
    "These are real comment bodies pulled from Reddit threads. Quote and pattern-match",
    "against THESE actual words — they count as cited real-people sources (use their URLs).",
    "Still run your own searches too, but do not ignore what's already here.",
    "",
    verbatims,
  ].join("\n");
}

export interface ResearchedAvatarDraft {
  name: string;
  shortDesc: string;
  painPoints: string;
  desires: string;
  objections: string;
  dailyLanguage: string;
  triggers: string;
  identity: string;
  socialProof: string;
  buyingContext: string;
  sources: string[];
  // The structured deep-dive profile (optional, best-effort). When present it's
  // persisted to AvatarResearch.profile and consumed by the pipeline.
  profile?: AvatarProfile | null;
  // Anti-hallucination check: source liveness + verbatim provenance (best-effort).
  verification?: DraftVerification | null;
  evidence?: ResearchEvidenceClaim[];
  quality?: ResearchQualityReport;
  researchId?: string;
  draftKey?: string;
}

interface EvidenceAwareDraft {
  sources: string[];
  evidence?: ResearchEvidenceClaim[];
  profile?: AvatarProfile | null;
  verification?: DraftVerification | null;
  quality?: ResearchQualityReport;
  researchId?: string;
  draftKey?: string;
}

async function finalizeEvidenceDrafts<T extends EvidenceAwareDraft>(input: {
  type: ResearchType;
  researchId: string;
  drafts: T[];
  labelOf: (draft: T) => string;
}): Promise<T[]> {
  return Promise.all(input.drafts.map(async (draft, index) => {
    const draftKey = deterministicResearchId(input.type, input.researchId, String(index), input.labelOf(draft));
    let verification: DraftVerification;
    try {
      verification = await verifyDraft({ sources: draft.sources, profile: draft.profile, evidence: draft.evidence });
    } catch {
      verification = {
        checkedAt: new Date().toISOString(),
        sources: draft.sources.map((url) => ({ url, canonicalUrl: null, domain: "", sourceType: "unknown", ok: false, status: 0, excerpt: "", contentHash: null })),
        sourcesOk: 0,
        sourcesTotal: draft.sources.length,
        verbatims: [],
        verbatimsVerified: 0,
        verbatimsTotal: 0,
        evidence: normalizeEvidenceClaims(draft.evidence),
      };
    }
    const evidence = verification.evidence;
    const quality = evaluateResearchQuality({ type: input.type, sources: verification.sources, evidence });
    return { ...draft, evidence, verification, quality, researchId: input.researchId, draftKey };
  }));
}

async function persistEvidenceResearchRun(input: {
  researchId: string;
  type: ResearchType;
  angleSlug: string | null;
  focus: string | null;
  queryPlan: ResearchQueryPlan;
  drafts: EvidenceAwareDraft[];
}): Promise<void> {
  const inserted = await supabase.from("Research").insert({
    id: input.researchId,
    type: input.type,
    angleSlug: input.angleSlug,
    focus: input.focus,
    drafts: JSON.stringify(input.drafts),
    status: "pending",
    notes: "Evidence-first research v1. Apply migration 011 to enable the reusable ledger and feedback tables.",
    createdAt: new Date().toISOString(),
  });
  if (inserted.error) throw new Error(inserted.error.message);
  await persistResearchLedger({
    researchId: input.researchId,
    type: input.type,
    queryPlan: input.queryPlan,
    drafts: input.drafts.map((draft): LedgerDraft => ({
      draftKey: draft.draftKey!,
      evidence: draft.evidence ?? [],
      verification: draft.verification ?? null,
      quality: draft.quality!,
    })),
  });
}

function assertResearchQuality(quality: ResearchQualityReport | undefined, overrideQuality: boolean): void {
  if (quality?.status === "reject" && !overrideQuality) {
    throw new Error(`This draft failed the evidence quality gate (${quality.score}/100). Review its blockers or choose Save anyway.`);
  }
}

const SYSTEM_PROMPT = [
  "You are a customer-research analyst. Your job is to find what REAL PEOPLE say about a problem — in their own words — not what marketers write about it.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "SOURCE DISCIPLINE — non-negotiable",
  "════════════════════════════════════════════════════════════════════════",
  "PRIORITIZE first-person voices from forums and comment sections. When you run Google queries, USE these site-restricted searches first:",
  "  • site:reddit.com",
  "  • site:quora.com",
  "  • site:youtube.com (for comments — pull from threads with engaged discussion)",
  "  • site:facebook.com/groups",
  "  • site:community.<brand>.com (e.g. community.fitbit.com, community.babycenter.com)",
  "  • site:patient.info, site:netmums.com, site:mumsnet.com, site:medhelp.org (condition-specific forums)",
  "  • site:tiktok.com/@<creator> when a creator's caption + comments are relevant",
  "Run 6-10 distinct queries minimum, mixing the angle's keywords with phrases like \"reddit\", \"what helps\", \"tried everything\", \"finally\", \"my experience\", \"i'm so tired of\".",
  "",
  "READ IN FULL — do not work from search snippets. After searching, OPEN the most promising forum/comment URLs with the url-context tool and read the ENTIRE thread, including the replies and comment sections. Snippets lie; the gold is in the back-and-forth. Open at least the top 4-6 URLs you find before drafting, and quote the actual words people wrote in those pages.",
  "",
  "REJECT and do not cite:",
  "  • SEO blog posts, listicles, brand category pages, affiliate roundups (the 'top 7 leggings for ___' content farm)",
  "  • Press releases, brand-owned blogs, e-commerce category pages",
  "  • AI-generated content farms (look for the telltale 'as a [X], I understand the importance of...' phrasing)",
  "  • Sources that don't quote actual people in their own words",
  "If a query returns mostly SEO content, REFINE the query (add `reddit`, `forum`, `experience`, or a `site:` operator) until you find first-person material.",
  "",
  "MINIMUM source bar: every sub-avatar draft must cite AT LEAST 3 real-people URLs (Reddit thread, Quora answer, YouTube comment thread, forum post, etc.). If you can't find 3 for a given candidate, drop the candidate.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "OUTPUT",
  "════════════════════════════════════════════════════════════════════════",
  "Synthesize 3-4 DISTINCT sub-avatar candidates. Distinct means different life stages, contexts, trigger moments, or value drivers — not 3 variants of the same person.",
  "Every claim must be backed by patterns you saw across multiple sources, never a single anecdote.",
  "Use real phrasing from the sources where possible — copy the words people use, not marketing language. Direct quotes (in their words) are great when available.",
  "",
  "Return EXACTLY one JSON object in this shape — no prose, no markdown fences, no preamble:",
  `{
  "drafts": [
    {
      "name": "3-6 word descriptor (e.g. 'End-of-day office worker 30-40')",
      "shortDesc": "1-sentence summary of who they are",
      "painPoints": "newline-separated bullets, real phrasing (include short direct quotes where possible)",
      "desires": "newline-separated bullets",
      "objections": "newline-separated bullets — common reasons NOT to buy",
      "dailyLanguage": "newline-separated phrases they actually use",
      "triggers": "newline-separated buying-trigger moments",
      "identity": "1-2 sentences on how they see themselves",
       "socialProof": "what proof would land — peer testimonials, doctor mentions, before/afters, etc.",
       "buyingContext": "where, when, how they shop for this",
       "sources": ["https://reddit.com/...", "https://quora.com/...", "https://..."],
       "evidence": [
         { "category": "pain|desire|objection|trigger|identity|failed_solution|mechanism", "type": "verbatim|claim|inference", "text": "one atomic quote, fact, or explicitly labelled inference", "sourceUrl": "exact page URL; omit only for inference", "sourceTitle": "page/thread title" }
       ],
       "profile": { "...": "the structured deep dive — see PROFILE OBJECT below" }
    }
  ]
}`,
  "",
  "════════════════════════════════════════════════════════════════════════",
  "PROFILE OBJECT — the structured deep dive (include it per draft, best-effort)",
  "════════════════════════════════════════════════════════════════════════",
  "For each draft, also include a \"profile\" object capturing the deep-dive sections from the",
  "DEPTH & QUALITY BAR, using these EXACT keys (omit any you genuinely can't ground — never invent):",
  "  voiceProfile: { register, humorStyle, cursingLevel, emotionalTone, formalityLevel(1-5) }",
  "  vocabulary: { powerWords[], phrasesToUse[], forbiddenWords[] (marketing clichés she rejects), registerRules[] }",
  "  sentencePatterns: { structures[], typicalLength, punctuationHabits }",
  "  emotionalRegister: { peak, baseline, suppressed, primaryEmotion }",
  "  metaphors: [{ image, whyResonates }]",
  "  bridgeToMechanism: { beliefGaps, howSheTalksAboutCause, hookBridge }",
  "  deepDesires: [{ surface, middle, core, massInstinct, connectionChain, copyAngle, scope(1-10), urgency(1-10), stayingPower(1-10) }]",
  "  big4: { bigFast:{applicable,angle}, newOnly:{...}, easyAnybody:{...}, safePredictable:{...}, strongest }",
  "  angleCandidates: [{ name, ev(1-10), ma(1-10), ws(1-10), exampleHook, reasonToBuy, emotionalLever, conceptDirections[] }]",
  "  languageMining: { pain[], desire[], identity[], actionCoping[], bodySensation[], emotionalState[], failedSolution[] }",
  "    — each item: { tier: \"verbatim\"|\"reconstructed\", text, source }",
  "  trust: { trustSignals[], skepticismObjections[], failedSolutions[] }",
  "  triggers: { triggerMoments[], desireCalendar: { peakMonths[], seasonalAngles:[{month,angle}] } }",
  "  identification: { selfImageToPortray, whereTheyWantToBe, whatTheyWantToFeel, whatTheyWantToLookLike }",
  "  buyerPsychology: { buyerVsUser, buyingEmotions:{fear,guilt,pride,shame,trust,excitement} (each 0-10),",
  "    painDesireRatio:{painPct,desirePct,copyImplication}, purchaseHesitation, counterStrategy }",
  "Include at least 5 atomic evidence items per draft. A verbatim must be copied exactly and point to the exact page where it appears. Claims must point to a supporting page. Uncited synthesis must use type=inference.",
].join("\n");

function extractJson(text: string): { drafts: ResearchedAvatarDraft[] } {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim()) as { drafts?: ResearchedAvatarDraft[] };
      if (Array.isArray(parsed.drafts)) return { drafts: parsed.drafts };
    } catch {
      // try next candidate
    }
  }
  throw new Error("Research response was not valid JSON with a `drafts` array.");
}

export async function researchSubAvatars(
  angleSlug: string,
  focus?: string | null,
): Promise<ResearchedAvatarDraft[]> {
  // Try the hardcoded map first; fall back to the DB for user-created angles.
  let angle = resolveAngle(angleSlug);
  if (!angle) {
    const row = unwrapOpt(
      await supabase.from("Angle").select("*").eq("slug", angleSlug).maybeSingle(),
    ) as {
      slug: string;
      name: string;
      requiredKeyword: string;
      mechanism: string;
      bannedMechanism: string;
      silhouette: string;
      colorway: string;
    } | null;
    if (row) {
      angle = {
        slug: row.slug,
        name: row.name,
        requiredKeyword: row.requiredKeyword,
        mechanism: row.mechanism,
        bannedMechanism: row.bannedMechanism,
        silhouette: row.silhouette,
        colorway: row.colorway,
      };
    }
  }
  if (!angle) throw new Error(`Unknown angle: ${angleSlug}`);

  const llm = getLLM();
  const queryPlan = await planResearchQueries({
    type: "sub_avatar",
    angle: angle.name,
    mechanism: angle.mechanism,
    focus,
  });
  const subs = subredditsForAngle({
    slug: angle.slug,
    name: angle.name,
    mechanism: angle.mechanism,
    requiredKeyword: angle.requiredKeyword,
    focus,
  });
  const [reddit, deepDive, existingItems, retrievedEvidence] = await Promise.all([
    gatherRedditVerbatims(
      queryPlanQueries(queryPlan, 4),
      { subreddits: subs },
    ),
    loadDeepDiveTemplate(),
    // Cross-run novelty pool: avatars we already own for this angle PLUS personas
    // surfaced by prior excavations of it — so research and excavation share memory.
    Promise.all([existingAvatarItems(angleSlug), priorExcavationItems(angleSlug)]).then(
      ([owned, excav]) => Array.from(new Set([...owned, ...excav])),
    ),
    retrieveResearchEvidence({ query: queryPlan.brief, angleSlug, topK: 8 }),
  ]);
  // The deep-dive template is the depth + quality bar. Even though this call still
  // emits the flat draft shape (the structured profile lands in a later step), the
  // template pushes the model to research at deep-dive depth, so the fields it does
  // fill (pain, daily language, triggers…) come back far more specific and verbatim.
  const systemInstruction = [
    SYSTEM_PROMPT,
    "",
    "════════════════════════════════════════════════════════════════════════",
    "DEPTH & QUALITY BAR — research to this standard before you draft",
    "════════════════════════════════════════════════════════════════════════",
    deepDive,
    "",
    "Apply that depth when you fill each draft's fields. painPoints/desires/dailyLanguage/",
    "triggers must read like the verbatim-grounded gold standard above — real phrasing, real",
    "specificity — not generic marketing language.",
  ].join("\n");
  const userPrompt = [
    `ANGLE: ${angle.name} (${angle.slug})`,
    `Mechanism the product addresses: ${angle.mechanism}`,
    focus
      ? `REQUIRED FOCUS FROM USER: "${focus}". Every candidate MUST fit this focus — it is not optional. If a candidate doesn't clearly match it, drop it.`
      : "",
    "",
    "Search the web. Find what people actually say about this angle's pain points, desires, and triggers — in their own words.",
    renderResearchQueryPlan(queryPlan),
    "Synthesize 3-4 distinct sub-avatar candidates. Distinct = different stages/contexts/triggers, not variants of one person.",
    "NOVELTY IS REQUIRED: every candidate must be genuinely different from the avatars in the 'ALREADY OWN' list below and from each other. Do not reword or re-skin an existing one.",
    "FILL EVERY FIELD WITH REAL RESEARCHED CONTENT in the avatar's own words — NEVER copy the field's description text from the schema (e.g. do not output 'newline-separated bullets, real phrasing…' as a value).",
    "Return ONLY the JSON object described in the system prompt.",
    exclusionBlock(
      "AVATARS WE ALREADY OWN FOR THIS ANGLE — DO NOT REPEAT THESE",
      "Each new candidate must be GENUINELY DIFFERENT (different life stage, trigger, context, body relationship, or core value driver) from every avatar below and from each other:",
      existingItems,
    ),
    renderSubredditBlock(subs),
    redditBlock(reddit),
    renderRetrievedResearchEvidence(retrievedEvidence),
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      // Roomier budget: each draft now also carries a structured profile object.
      maxOutputTokens: 32768,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "sub_avatar_research",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { angleSlug, focus: focus ?? undefined },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Research returned no text content.");
  const { drafts } = extractJson(text);
  if (drafts.length === 0) throw new Error("Research returned zero candidates — try again or add focus.");
  const normalized = drafts.map((d) => ({
    name: d.name ?? "",
    shortDesc: d.shortDesc ?? "",
    painPoints: d.painPoints ?? "",
    desires: d.desires ?? "",
    objections: d.objections ?? "",
    dailyLanguage: d.dailyLanguage ?? "",
    triggers: d.triggers ?? "",
    identity: d.identity ?? "",
    socialProof: d.socialProof ?? "",
    buyingContext: d.buyingContext ?? "",
    sources: Array.isArray(d.sources) ? d.sources.filter((s) => typeof s === "string") : [],
    evidence: normalizeEvidenceClaims((d as { evidence?: unknown }).evidence),
    // Loosely parse the structured profile; null when absent or unusable.
    profile: parseAvatarProfile((d as { profile?: unknown }).profile),
    verification: null as DraftVerification | null,
  }));

  // Novelty gate (lexical + semantic): drop candidates that repeat an existing
  // avatar or each other. Keeps originals if it would empty the list.
  const novelDrafts = await dedupeNovel(
    normalized,
    existingItems,
    (d) => `${d.name} ${d.shortDesc} ${d.painPoints}`,
  );
  const researchId = newId();
  const finalDrafts = await finalizeEvidenceDrafts({
    type: "sub_avatar",
    researchId,
    drafts: novelDrafts,
    labelOf: (draft) => draft.name,
  });
  await persistEvidenceResearchRun({ researchId, type: "sub_avatar", angleSlug, focus: focus ?? null, queryPlan, drafts: finalDrafts });
  revalidatePath("/research");
  return finalDrafts;
}

// ─── ANGLE RESEARCH ──────────────────────────────────────────────────────────
export interface ResearchedAngleDraft {
  name: string;
  slug: string;
  positioning: string;       // 1-2 sentence positioning
  mechanism: string;         // what physiology / situation the angle owns
  requiredKeyword: string;
  bannedMechanism: string;
  audienceNote: string;      // who this targets
  sources: string[];
  evidence?: ResearchEvidenceClaim[];
  verification?: DraftVerification | null;
  quality?: ResearchQualityReport;
  researchId?: string;
  draftKey?: string;
}

const ANGLE_RESEARCH_SYSTEM_PROMPT = [
  "You are a DTC ads strategist. You find ANGLES by listening to what REAL PEOPLE complain about, ask about, and celebrate solving — not by reading marketing copy.",
  "An ANGLE is a strategic positioning the brand can own — a specific problem or identity the product solves for a distinct audience. Examples: 'Post-Pregnancy', 'Heavy Legs', 'Lipoedema'.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "SOURCE DISCIPLINE — non-negotiable",
  "════════════════════════════════════════════════════════════════════════",
  "PRIORITIZE first-person voices from forums and comment sections. USE site-restricted Google queries:",
  "  • site:reddit.com — START with the communities in the SUBREDDITS block below, but do NOT limit yourself to them; search all of Reddit and follow the discussion into any other relevant subreddit you find",
  "  • site:quora.com",
  "  • site:youtube.com (engaged comment threads on relevant creator videos)",
  "  • site:mumsnet.com, site:netmums.com, site:babycenter.com/community, site:patient.info, site:medhelp.org",
  "  • site:tiktok.com/@<creator> for caption + top comments where the discussion is real",
  "Mix the focus keyword with phrases like \"reddit\", \"what helps\", \"finally\", \"tried everything\", \"my experience\", \"anyone else\".",
  "Also scan Meta Ads Library for what is currently RUNNING in compression / wellness / leggings — that tells you which angles brands are spending on.",
  "Run 8+ distinct queries minimum.",
  "",
  "READ IN FULL — do not work from search snippets. After searching, OPEN the most promising forum/comment URLs with the url-context tool and read the ENTIRE thread, including replies and comment sections, before forming an angle. Open at least the top 5-6 URLs you find and base the angle on patterns you actually saw across those full pages.",
  "",
  "REJECT and do not cite:",
  "  • SEO blog posts, listicles, brand category pages, affiliate roundups",
  "  • Press releases, brand-owned blogs, e-commerce category pages",
  "  • AI-generated content farms",
  "  • Anything that doesn't quote actual people in their own words OR show a real ad creative",
  "",
  "Return 3-5 DISTINCT angle candidates. Distinct = different physiological mechanisms, different audiences, or different trigger contexts.",
  "Every angle must cite AT LEAST 3 sources, with at least 2 of them being real-people forum/community URLs (Reddit, Quora, Mumsnet, etc.). Meta Ads Library counts as supporting evidence but does NOT substitute for the forum sources.",
  "Include at least 5 atomic evidence items per draft. Exact quotes use type=verbatim and must point to the exact page. Uncited synthesis must use type=inference.",
  "",
  "Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:",
  `{
  "drafts": [
    {
      "name": "Display name (Title Case, 2-4 words)",
      "slug": "kebab-case-slug",
      "positioning": "1-2 sentence positioning — who this is for and why the product wins",
      "mechanism": "the physiological / lifestyle mechanism this angle owns",
      "requiredKeyword": "1 word that MUST appear in every prompt for this angle",
      "bannedMechanism": "pipe|separated|mechanisms from other angles that would dilute this one",
       "audienceNote": "1-sentence description of the target audience",
       "sources": ["https://...", "https://..."],
       "evidence": [
         { "category": "pain|desire|trigger|mechanism|market_signal", "type": "verbatim|claim|inference", "text": "one atomic quote, fact, or explicitly labelled inference", "sourceUrl": "exact source URL; omit only for inference", "sourceTitle": "page/thread title" }
       ]
    }
  ]
}`,
].join("\n");

export async function researchAngles(focus?: string | null): Promise<ResearchedAngleDraft[]> {
  const llm = getLLM();
  const queryPlan = await planResearchQueries({ type: "angle", focus });
  // Open exploration with no focus casts across every cluster; a focus narrows it.
  const subs = subredditsForAngle({ focus });
  const [reddit, retrievedEvidence] = await Promise.all([
    gatherRedditVerbatims(queryPlanQueries(queryPlan, 4), { subreddits: subs }),
    retrieveResearchEvidence({ query: queryPlan.brief, topK: 8 }),
  ]);
  // Angles we already own — feed them in so the model proposes genuinely new ones.
  const existingAngleRows = ((await supabase.from("Angle").select("name, mechanism")).data ?? []) as {
    name: string;
    mechanism: string | null;
  }[];
  const existingAngleItems = existingAngleRows.map(
    (a) => `${a.name}${a.mechanism ? ` — ${a.mechanism.slice(0, 90)}` : ""}`,
  );
  const userPrompt = [
    focus ? `FOCUS FROM USER: ${focus}` : "FOCUS: open exploration — surface any angle currently working.",
    "",
    "Search the web NOW. Find what is currently winning in the DTC compression / wellness / leggings ad space.",
    renderResearchQueryPlan(queryPlan),
    "Propose 3-5 distinct angle candidates following the schema in the system prompt.",
    "NOVELTY IS REQUIRED: every angle must be genuinely different from the ones we already own (below) and from each other — a different mechanism, audience, or trigger. Do not reword an existing angle.",
    "Return ONLY the JSON object described in the system prompt.",
    exclusionBlock(
      "ANGLES WE ALREADY OWN — DO NOT REPEAT THESE",
      "Propose angles that are clearly distinct from every one of these:",
      existingAngleItems,
    ),
    renderSubredditBlock(subs),
    redditBlock(reddit),
    renderRetrievedResearchEvidence(retrievedEvidence),
  ].filter(Boolean).join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: ANGLE_RESEARCH_SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "angle_research",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { focus: focus ?? undefined },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Angle research returned no text content.");
  let parsed: { drafts?: Partial<ResearchedAngleDraft>[] } = {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      parsed = JSON.parse(c.trim());
      if (Array.isArray(parsed.drafts)) break;
    } catch {/* try next */}
  }
  if (!Array.isArray(parsed.drafts)) throw new Error("Angle research response was not valid JSON.");
  const normalized: ResearchedAngleDraft[] = parsed.drafts.map((d) => ({
    name: d.name ?? "",
    slug: (d.slug ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    positioning: d.positioning ?? "",
    mechanism: d.mechanism ?? "",
    requiredKeyword: d.requiredKeyword ?? "",
    bannedMechanism: d.bannedMechanism ?? "",
    audienceNote: d.audienceNote ?? "",
    sources: Array.isArray(d.sources) ? d.sources.filter((s) => typeof s === "string") : [],
    evidence: normalizeEvidenceClaims((d as { evidence?: unknown }).evidence),
  }));
  // Novelty gate (lexical + semantic) vs existing angles and each other.
  const novelDrafts = await dedupeNovel(
    normalized,
    existingAngleItems,
    (d) => `${d.name} ${d.positioning} ${d.mechanism}`,
  );
  const researchId = newId();
  const finalDrafts = await finalizeEvidenceDrafts({
    type: "angle",
    researchId,
    drafts: novelDrafts,
    labelOf: (draft) => draft.name,
  });
  await persistEvidenceResearchRun({ researchId, type: "angle", angleSlug: null, focus: focus ?? null, queryPlan, drafts: finalDrafts });
  revalidatePath("/research");
  return finalDrafts;
}

export async function saveResearchedAngle(draft: ResearchedAngleDraft, overrideQuality = false): Promise<{ angleId: string }> {
  if (!draft.name?.trim()) throw new Error("Draft is missing a name.");
  assertResearchQuality(draft.quality, overrideQuality);
  // Derive a unique slug.
  const base =
    draft.slug ||
    draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = base || `ai-angle-${Date.now()}`;
  let n = 2;
  while (
    unwrapOpt(await supabase.from("Angle").select("id").eq("slug", slug).maybeSingle())
  ) {
    slug = `${base}-${n++}`;
  }
  const lastRes = await supabase.from("Angle").select("order").order("order", { ascending: false }).limit(1);
  const lastOrder = (lastRes.data?.[0]?.order as number | undefined) ?? 0;
  const created = unwrap(
    await supabase
      .from("Angle")
      .insert({
        id: newId(),
        slug,
        name: draft.name,
        requiredKeyword: draft.requiredKeyword || draft.name.toLowerCase(),
        mechanism: draft.mechanism,
        bannedMechanism: draft.bannedMechanism ?? "",
        silhouette: "short-legging",
        colorway: "pink",
        order: lastOrder + 1,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );
  revalidatePath("/avatars");
  revalidatePath("/research");
  return { angleId: (created as unknown as { id: string }).id };
}

// ─── CONCEPT RESEARCH ────────────────────────────────────────────────────────
export interface ResearchedConceptDraft {
  title: string;
  hook: string;
  headline: string;
  visualConcept: string;
  reasoning: string;       // why this concept is working now
  sources: string[];
  evidence?: ResearchEvidenceClaim[];
  verification?: DraftVerification | null;
  quality?: ResearchQualityReport;
  researchId?: string;
  draftKey?: string;
}

const CONCEPT_RESEARCH_SYSTEM_PROMPT = [
  "You are a DTC ads strategist. You source winning ad concepts by combining (a) real ads currently running and (b) the language/emotion REAL PEOPLE use about the problem.",
  "An ad concept = one shippable creative idea: a hook, a headline, and a visual.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  "SOURCE DISCIPLINE — non-negotiable",
  "════════════════════════════════════════════════════════════════════════",
  "STEP 1 — REAL ADS RUNNING (what's actually being spent on):",
  "  • Meta Ads Library queries for keywords related to this angle",
  "  • site:tiktok.com/@<creator> for creator UGC ads in this niche",
  "  • site:youtube.com Shorts and ad-style videos with high engagement",
  "STEP 2 — REAL PEOPLE LANGUAGE (so the hook actually lands):",
  "  • site:reddit.com (relevant subs)",
  "  • site:quora.com",
  "  • site:mumsnet.com, site:netmums.com, site:babycenter.com/community, site:patient.info, site:medhelp.org",
  "  • YouTube + TikTok comment threads on the ads you found in Step 1",
  "Mix the angle keyword with phrases like \"reddit\", \"finally\", \"anyone else\", \"what worked\", \"the moment i\".",
  "Run 6+ distinct queries minimum.",
  "",
  "READ IN FULL — do not work from search snippets. After searching, OPEN the most promising ad and forum/comment URLs with the url-context tool and read the ENTIRE page, including the comment threads, before writing a concept. The hook copy should echo phrasing you actually read on those full pages, not snippets.",
  "",
  "REJECT and do not cite:",
  "  • SEO blog listicles ('top 7 leggings for ___')",
  "  • Brand-owned blog posts dressed up as advice",
  "  • Affiliate roundups, press releases",
  "  • AI-generated content farm articles",
  "  • Anything that isn't either (a) a real ad creative or (b) a real-person voice",
  "",
  "Return 4-6 DISTINCT concepts. Distinct = different hook mechanics (question, transformation, social proof, identity, contrast, demo, etc.), different emotional entries, different visual setups.",
  "Every concept must cite AT LEAST 3 sources, mixing at least one real-ad URL (Meta Ads Library / TikTok / YouTube) AND at least one real-people URL (Reddit / Quora / forum).",
  "The hook copy you propose should echo phrasing you actually saw in the real-people sources — not generic marketing language.",
  "Include at least 5 atomic evidence items per concept. Exact customer/ad quotes use type=verbatim and must point to the exact page. Uncited strategy must use type=inference.",
  "",
  "Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:",
  `{
  "drafts": [
    {
      "title": "Short title (3-6 words)",
      "hook": "The opening idea / spike — one sentence",
      "headline": "Specific headline copy that goes with this concept",
      "visualConcept": "1-2 sentences describing what's on screen / in the image",
       "reasoning": "1 sentence on why this is working now (what trend, what platform, what audience reaction)",
       "sources": ["https://...", "https://..."],
       "evidence": [
         { "category": "customer_language|ad_pattern|visual_pattern|objection|market_signal", "type": "verbatim|claim|inference", "text": "one atomic quote, observation, or explicitly labelled inference", "sourceUrl": "exact source URL; omit only for inference", "sourceTitle": "ad/page/thread title" }
       ]
    }
  ]
}`,
].join("\n");

export async function researchConcepts(
  angleSlug: string,
  focus?: string | null,
): Promise<ResearchedConceptDraft[]> {
  let angle = resolveAngle(angleSlug);
  if (!angle) {
    const row = unwrapOpt(
      await supabase.from("Angle").select("*").eq("slug", angleSlug).maybeSingle(),
    ) as {
      slug: string;
      name: string;
      requiredKeyword: string;
      mechanism: string;
      bannedMechanism: string;
      silhouette: string;
      colorway: string;
    } | null;
    if (row) {
      angle = {
        slug: row.slug,
        name: row.name,
        requiredKeyword: row.requiredKeyword,
        mechanism: row.mechanism,
        bannedMechanism: row.bannedMechanism,
        silhouette: row.silhouette,
        colorway: row.colorway,
      };
    }
  }
  if (!angle) throw new Error(`Unknown angle: ${angleSlug}`);

  const llm = getLLM();
  const queryPlan = await planResearchQueries({
    type: "concept",
    angle: angle.name,
    mechanism: angle.mechanism,
    focus,
  });
  const subs = subredditsForAngle({
    slug: angle.slug,
    name: angle.name,
    mechanism: angle.mechanism,
    requiredKeyword: angle.requiredKeyword,
    focus,
  });
  const [reddit, retrievedEvidence] = await Promise.all([
    gatherRedditVerbatims(queryPlanQueries(queryPlan, 4), { subreddits: subs }),
    retrieveResearchEvidence({ query: queryPlan.brief, angleSlug, topK: 8 }),
  ]);
  // Hooks/headlines we already have — so the model finds fresh concepts.
  const [concRes, winRes] = await Promise.all([
    supabase.from("Research").select("drafts").eq("type", "concept").order("createdAt", { ascending: false }).limit(8),
    supabase.from("WinningAd").select("headline").order("createdAt", { ascending: false }).limit(40),
  ]);
  const existingConceptItems: string[] = [];
  for (const r of (concRes.data ?? []) as { drafts: string }[]) {
    try {
      for (const c of JSON.parse(r.drafts) as { hook?: string; headline?: string }[]) {
        if (c?.hook) existingConceptItems.push(c.hook);
        if (c?.headline) existingConceptItems.push(c.headline);
      }
    } catch {
      /* ignore */
    }
  }
  for (const w of (winRes.data ?? []) as { headline: string | null }[]) if (w.headline) existingConceptItems.push(w.headline);

  const userPrompt = [
    `ANGLE: ${angle.name} (${angle.slug})`,
    `Mechanism: ${angle.mechanism}`,
    focus ? `EXTRA FOCUS: ${focus}` : "",
    "",
    "Search the web NOW. Find specific ad concepts currently winning for this angle (hook + headline + visual).",
    renderResearchQueryPlan(queryPlan),
    "Propose 4-6 distinct concepts following the schema in the system prompt.",
    "NOVELTY IS REQUIRED: every concept's hook + headline must be genuinely different from the ones we already have (below) and from each other. Do not reword an existing hook.",
    "Return ONLY the JSON object described in the system prompt.",
    exclusionBlock(
      "HOOKS / HEADLINES WE ALREADY HAVE — DO NOT REPEAT THESE",
      "Your concepts must not restate or lightly reword any of these:",
      existingConceptItems,
    ),
    renderSubredditBlock(subs),
    redditBlock(reddit),
    renderRetrievedResearchEvidence(retrievedEvidence),
  ].filter(Boolean).join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: CONCEPT_RESEARCH_SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "concept_research",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { angleSlug, focus: focus ?? undefined },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Concept research returned no text content.");
  let parsed: { drafts?: Partial<ResearchedConceptDraft>[] } = {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      parsed = JSON.parse(c.trim());
      if (Array.isArray(parsed.drafts)) break;
    } catch {/* try next */}
  }
  if (!Array.isArray(parsed.drafts)) throw new Error("Concept research response was not valid JSON.");
  const normalized: ResearchedConceptDraft[] = parsed.drafts.map((d) => ({
    title: d.title ?? "",
    hook: d.hook ?? "",
    headline: d.headline ?? "",
    visualConcept: d.visualConcept ?? "",
    reasoning: d.reasoning ?? "",
    sources: Array.isArray(d.sources) ? d.sources.filter((s) => typeof s === "string") : [],
    evidence: normalizeEvidenceClaims((d as { evidence?: unknown }).evidence),
  }));
  // Novelty gate (lexical + semantic) vs existing hooks/headlines and each other.
  const novelDrafts = await dedupeNovel(normalized, existingConceptItems, (d) => `${d.hook} ${d.headline}`);
  const researchId = newId();
  const finalDrafts = await finalizeEvidenceDrafts({
    type: "concept",
    researchId,
    drafts: novelDrafts,
    labelOf: (draft) => `${draft.title} ${draft.hook}`,
  });
  await persistEvidenceResearchRun({ researchId, type: "concept", angleSlug, focus: focus ?? null, queryPlan, drafts: finalDrafts });
  revalidatePath("/research");
  return finalDrafts;
}

export async function saveResearchedSubAvatar(input: {
  angleSlug: string;
  draft: ResearchedAvatarDraft;
  overrideQuality?: boolean;
}): Promise<{ subAvatarId: string }> {
  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("slug", input.angleSlug).maybeSingle(),
  ) as { id: string } | null;
  if (!angle) throw new Error(`Unknown angle: ${input.angleSlug}`);

  const d = input.draft;
  if (!d.name?.trim()) throw new Error("Draft is missing a name.");
  assertResearchQuality(d.quality, Boolean(input.overrideQuality));

  const base = d.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  let slug = base || `ai-${Date.now()}`;
  let attempt = 0;
  while (
    unwrapOpt(await supabase.from("SubAvatar").select("id").eq("slug", slug).maybeSingle())
  ) {
    attempt++;
    slug = `${base}-${attempt}`;
  }

  const subAvatarId = newId();
  const now = new Date().toISOString();
  const subInsert = await supabase
    .from("SubAvatar")
    .insert({
      id: subAvatarId,
      angleId: angle.id,
      slug,
      name: `[AI] ${d.name}`,
      shortDesc: d.shortDesc || null,
      createdAt: now,
      updatedAt: now,
    });
  if (subInsert.error) throw new Error(subInsert.error.message);
  const sub = { id: subAvatarId };
  const baseRow = {
    id: newId(),
    subAvatarId: sub.id,
    painPoints: d.painPoints,
    desires: d.desires,
    objections: d.objections,
    dailyLanguage: d.dailyLanguage,
    triggers: d.triggers,
    identity: d.identity,
    socialProof: d.socialProof,
    buyingContext: d.buyingContext,
    notes: d.sources?.length ? `Generated from web research. Sources:\n${d.sources.join("\n")}` : "Generated from web research.",
    createdAt: now,
    updatedAt: now,
  };
  // Persist the structured deep dive when present. The `profile` column ships in
  // migration 003 — if it hasn't been run yet, degrade gracefully (save the flat
  // fields, drop the profile) instead of failing the whole save.
  const researchInsert = await supabase
    .from("AvatarResearch")
    .insert({ ...baseRow, profile: d.profile ? JSON.stringify(d.profile) : null });
  if (researchInsert.error) {
    if (/profile/i.test(researchInsert.error.message) && /column|does not exist|schema cache/i.test(researchInsert.error.message)) {
      const retry = await supabase.from("AvatarResearch").insert(baseRow);
      if (retry.error) throw new Error(retry.error.message);
      console.warn("AvatarResearch.profile column missing — saved without the deep-dive profile. Run migration 003_avatar_profile.sql to enable it.");
    } else {
      throw new Error(researchInsert.error.message);
    }
  }

  revalidatePath("/avatars");
  return { subAvatarId: sub.id };
}
