// The CelluMove generation pipeline — a gated G1→G7 chain. Each stage is one
// Gemini call (via runAgent) whose output feeds the next. G1 (Avatar Excavation)
// and G2 (Avatar Deep Dive) are the EXISTING research flow — the sub-avatar's
// flat research + structured deep-dive profile — so this file only defines the
// new generative stages G3→G7 (plus Brand DNA). Definitions are drafted from a
// standard direct-response method (RMBC-style) and are meant to be reviewed/edited.

import type { AgentRole } from "./agents";

export type PipelineStageKey =
  | "deepDive"
  | "avatarIntel"
  | "rootCause"
  | "brandDna"
  | "copyArsenal"
  | "advertorial"
  | "adScripts"
  | "creativeBriefs";

export interface PipelineStageDef {
  key: PipelineStageKey;
  code: string;          // badge shown in the stepper: "G2", "G3", "DNA", "G4"…
  title: string;
  role: AgentRole;       // which roster role (pulls that role's SOPs)
  feature: string;       // usage-tracking tag
  blurb: string;         // one-line description for the UI
  needs: PipelineStageKey[]; // prior stages whose output is fed in as context
  instruction: string;   // the system instruction incl. the output JSON schema
  maxOutputTokens?: number;
  thinkingBudget?: number;
  // When true the stage runs GROUNDED (googleSearch + urlContext, real web/Reddit
  // research) instead of the closed-book JSON-mode agent call. Output is parsed
  // from text since Vertex disallows tools + responseMimeType together.
  grounded?: boolean;
}

// Brand + claims facts every stage inherits. Keeps generation on-brand and inside
// the legal guardrail the rest of the engine enforces.
export const BRAND_BASE =
  "BRAND: CelluMove — 3D-shaping compression leggings with targeted compression zones engineered for a smoother, sculpted, supported look.";

// Product-category search terms. Used to anchor YouTube/social queries to the BRAND
// (compression / shaping leggings) so results are relevant to what CelluMove sells —
// not just the avatar's problem in the abstract. Combine with the avatar's problem.
export const BRAND_PRODUCT_TERMS = [
  "compression leggings",
  "3D shaping leggings",
  "shaping leggings",
  "shapewear leggings",
];

export const CLAIMS_GUARDRAIL = [
  "CLAIMS GUARDRAIL (non-negotiable): compression SUPPORTS and shapes — it does not cure, treat, melt, dissolve, or remove anything.",
  "Never use: cure / eliminate / melt / dissolve / gone / removes / permanent / detox.",
  "Use instead: 'smoother', 'the appearance of', 'less noticeable', 'feels firmer', 'supported', 'sculpted look'.",
  "Stay inside the angle's own mechanism; never leak a banned mechanism from another angle.",
].join("\n");

export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    key: "deepDive",
    code: "G2",
    title: "Avatar Deep Dive",
    role: "researcher",
    feature: "pipeline_g2_deep_dive",
    blurb: "Grounded Reddit deep-dive research — real threads, exact quotes, multiple perspectives, pattern-level insight.",
    needs: [],
    grounded: true,
    maxOutputTokens: 49152,
    thinkingBudget: 8192,
    instruction: [
      "You are a top creative strategist for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche. Your mission: a DEEP DIVE on the target customer (the avatar named in the task) to gain a real, emotional, data-backed understanding of our ideal audience — to uncover raw insights for killer ad angles, irresistible messaging, and content that deeply resonates and converts.",
      "You are filling out an AVATAR DEEP DIVE RESEARCH document from REAL findings on Reddit.",
      "",
      "HOW TO APPROACH THIS TASK:",
      "• GO DEEP — no surface-level answers. Compile entire posts and threads that reflect what real people think, feel, and experience, in their own words.",
      "• USE REAL CUSTOMER LANGUAGE — include exact quotes, especially phrases that show frustrations, fears, aspirations, and desires. These words are gold for ad copy and angles.",
      "• ANALYZE MULTIPLE PERSPECTIVES — for every theme, include varied opinions, conversations, debates, and commentary. Get a well-rounded view, not one side.",
      "• PRIORITIZE PATTERNS OVER OUTLIERS — find the big, shared beliefs, struggles, and desires that unite the audience; focus on common stories that keep recurring. Note real outliers separately.",
      "• EXPLORE THE GIVEN SUBREDDITS AND GO BEYOND — follow rabbit holes into adjacent communities that fit the avatar's world.",
      "• KEEP CONTEXT INTACT — don't just list quotes. Structure findings like real Reddit conversations: post titles, back-and-forth discussion, then a brief summary insight tying it back to the avatar's psychology.",
      "",
      "════════════════════════════════════════════════════════════════════════",
      "SOURCE DISCIPLINE — non-negotiable",
      "════════════════════════════════════════════════════════════════════════",
      "Prioritize Reddit. Run 8+ grounded queries mixing the avatar/angle keywords with: site:reddit.com, \"reddit\", \"what helps\", \"tried everything\", \"finally\", \"anyone else\", \"my experience\".",
      "GO BEYOND REDDIT — also mine YouTube comment sections (real top comments are already provided below — quote them), Quora answers, and niche forums. For a YouTube source set the thread's \"subreddit\" to \"YouTube\" (or the channel) and the \"url\" to the video link; for Quora/forums use the page URL.",
      "READ IN FULL — after searching, OPEN the most promising threads/pages with the url-context tool and read the ENTIRE thread (post + comments) before drafting. Snippets lie; the gold is in the back-and-forth.",
      "Every thread you report MUST include its real reddit URL, and every quote must be the user's actual words from a thread you opened. Do NOT invent threads, quotes, or URLs.",
      "REJECT SEO listicles, brand blogs, affiliate roundups, and AI content farms.",
      "",
      "Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:",
      `{
  "avatar": "1-2 sentence summary of who she is",
  "subredditsExplored": ["r/...", "r/..."],
  "themes": [
    {
      "theme": "one of: frustrations | fears | desires | aspirations | objections | daily life | trigger moments | identity",
      "threads": [
        {
          "subreddit": "r/...",
          "postTitle": "the real post title",
          "url": "https://www.reddit.com/...",
          "exchange": [ { "speaker": "OP | replier", "quote": "their exact words" } ],
          "summaryInsight": "what this thread reveals about her psychology"
        }
      ],
      "pattern": "the big shared pattern across these threads (what keeps recurring)",
      "topQuotes": [ { "text": "exact verbatim quote", "source": "https://www.reddit.com/..." } ]
    }
  ],
  "bigPatterns": ["the dominant shared beliefs / struggles / desires across the whole community"],
  "painPoints": ["..."],
  "desires": ["..."],
  "fears": ["..."],
  "objections": ["..."],
  "dailyLanguage": ["exact phrases she actually uses"],
  "outliers": ["notable minority views, explicitly labelled as outliers"]
}`,
    ].join("\n"),
  },
  {
    key: "avatarIntel",
    code: "AIR",
    title: "Avatar Intelligence Report",
    role: "strategist",
    feature: "pipeline_air_avatar_intel",
    blurb: "Synthesizes the G2 corpus into market intelligence — segments, ranked problems, emotions, triggers, opportunities, and 20 scored angles.",
    needs: ["deepDive"],
    maxOutputTokens: 49152,
    thinkingBudget: 8192,
    instruction: [
      "You are running the AVATAR INTELLIGENCE REPORT stage of the CelluMove pipeline.",
      "GOAL: understand the market before writing a single hook. This report is the strategic foundation every downstream stage (mechanism, copy, scripts) builds on.",
      "",
      "INPUTS — you are given the avatar's G1 research and the grounded G2 deep-dive corpus: its synthesis, big patterns, and a large bank of REAL verbatims (Reddit + YouTube). This stage is pure SYNTHESIS of that gathered research — no new web research.",
      "Base EVERY section on the corpus. Quote her real language from the verbatims. Never invent quotes, stats, segments, or facts the corpus doesn't support.",
      "Competitor/alternative intel comes from the corpus itself — what she says she tried (SPANX, Skims, pharmacy stockings, creams…), what failed her, and why she distrusts it.",
      CLAIMS_GUARDRAIL,
      "",
      "Produce ALL sections:",
      "  1. AVATAR SUMMARY — who exactly is this customer?",
      "  2. AVATAR SEGMENTS — identify 10-20 distinct sub-avatars (e.g. 'Women whose legs became heavy after menopause'). Distinct = different life stage, context, trigger, or value driver.",
      "  3. CORE PROBLEMS — every major problem, RANKED, with why each matters.",
      "  4. EMOTIONAL PROBLEMS — the pain beneath the surface (identity loss, embarrassment, fear, grief, isolation, body betrayal…).",
      "  5. TRIGGER MOMENTS — every trigger (mirror, vacation, wedding, dressing room, summer, sock marks, old photos…).",
      "  6. EXISTING BELIEFS — what do they already believe?",
      "  7. OBJECTIONS — every objection.",
      "  8. DESIRED OUTCOMES — functional, emotional, identity, lifestyle.",
      "  9. HIDDEN INSIGHTS — emotional truths NOT directly stated in the research.",
      "  10. OPPORTUNITY SCORE — rank every opportunity: opportunity / score / why.",
      "  11. BEST ADVERTISING ANGLES — EXACTLY 20 angles. Each: name, which segment it targets, problem, emotion, awareness level, why it works, expected CTR (1-10), originality (1-10), Meta performance score (1-10).",
      "  12. Finally answer: if you had $500,000 to spend on Meta tomorrow, which 5 angles would you test first and why?",
      "",
      "Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:",
      `{
  "avatarSummary": "3-6 sentences — who exactly this customer is",
  "segments": [ { "name": "string", "description": "string", "buyingAwareness": "unaware|problem-aware|solution-aware|product-aware|most-aware", "biggestFrustration": "string", "biggestDesire": "string" } ],
  "coreProblems": [ { "rank": 1, "problem": "string", "whyItMatters": "string" } ],
  "emotionalProblems": [ { "emotion": "string", "howItShowsUp": "how it surfaces in her words/behavior" } ],
  "triggerMoments": ["string"],
  "existingBeliefs": ["string"],
  "objections": ["string"],
  "desiredOutcomes": { "functional": ["string"], "emotional": ["string"], "identity": ["string"], "lifestyle": ["string"] },
  "hiddenInsights": ["string"],
  "opportunities": [ { "opportunity": "string", "score": 1-10, "why": "string" } ],
  "angles": [ { "name": "string", "avatar": "which segment this targets", "problem": "string", "emotion": "string", "awarenessLevel": "unaware|problem-aware|solution-aware|product-aware|most-aware", "whyItWorks": "string", "expectedCtr": 1-10, "originality": 1-10, "metaPerformanceScore": 1-10 } ],
  "budget500kTestPlan": [ { "angleName": "string", "why": "string" } ]
}`,
      "Give 10-20 segments, EXACTLY 20 angles, and EXACTLY 5 budget500kTestPlan picks (ordered by priority).",
    ].join("\n"),
  },
  {
    key: "rootCause",
    code: "G3",
    title: "Root Cause & Mechanism",
    role: "strategist",
    feature: "pipeline_g3_root_cause",
    blurb: "Villains + hierarchy, the unique mechanism with named steps & copy, belief work, proof stack, and objection preempts.",
    needs: ["deepDive", "avatarIntel"],
    maxOutputTokens: 49152,
    thinkingBudget: 8192,
    instruction: [
      "You are running the ROOT CAUSE & MECHANISM stage of the CelluMove pipeline — the RMBC 'Mechanism' deliverable.",
      "Produce a COMPLETE Root Cause & Mechanism document for THIS avatar and angle, following the exact structure below.",
      "Generate ALL content fresh from the avatar research + angle mechanism. Do NOT copy any example; the postpartum '2-Hour Compression Reset Protocol' is only an illustration of the DEPTH and FORMAT expected.",
      "",
      "QUALITY BAR (match this depth):",
      "  • Villains externalise blame onto a SYSTEM / HIDDEN ENEMY / SELF-SABOTEUR — never her body or her choices.",
      "  • The mechanism must EXPLAIN why everything she tried failed, and make CelluMove's fix feel inevitable once she gets the science.",
      "  • Use her real phrasing from the research. Be specific and falsifiable. Quote real moments (e.g. 'the 2pm bathroom adjustment').",
      "  • Ground the science in the angle's mechanism. Borrow authority from established clinical/physiological fields where honest.",
      CLAIMS_GUARDRAIL,
      "",
      "Return EXACTLY one JSON object with these keys (omit a field only if you genuinely cannot ground it; never invent fake citations):",
      `{
  "villains": [
    {
      "type": "the_system | hidden_enemy | self_saboteur",
      "name": "vivid named villain",
      "intensity": 1-10,
      "copyLines": ["punchy externalising lines in her voice"],
      "proofPoints": ["observable, defensible patterns"],
      "whatTheyDo": "string",
      "whyTheyDoIt": "string",
      "credibilityCheck": "why these claims are defensible / not defamatory",
      "usVsThemFraming": "string",
      "evidence": "for hidden_enemy: the documented mechanism",
      "guiltRemoval": "for self_saboteur: exonerate her",
      "redemptionArc": "for self_saboteur: how the product breaks the loop"
    }
  ],
  "villainHierarchy": { "primary": "which villain leads + why", "secondary": "string", "tertiary": "string", "recommendedSequence": "how to deploy across the funnel" },
  "villainCombinations": [ { "comboName": "string", "bestFor": "placement", "narrative": "the combined story", "villainsUsed": ["the_system","hidden_enemy"] } ],
  "mechanism": {
    "name": "the branded protocol/mechanism name",
    "steps": [ { "number": 1, "name": "step name", "analogy": "everyday analogy", "timeframe": "string", "proofPoint": "borrowed authority", "whatItDoes": "string", "keyIngredientOrAction": "the product feature this maps to", "howItConnectsToRootCause": "string" } ],
    "tagline": "string",
    "copyReady": { "emailTease": "string", "adMechanismHook": "string", "landingPageHeadline": "string", "vslMechanismSection": "string", "ugcMechanismExplanation": "first-person UGC" },
    "positioning": "one word/phrase (e.g. protocol/system/method)",
    "whyThisName": "why this name builds trust with THIS avatar"
  },
  "alternativeNames": [ { "name": "string", "style": "tech|clinical|authority|natural", "bestFor": "string" } ],
  "mechanismProof": { "logicalProof": "if root cause X then solution must Y", "demonstrationIdea": "a visual/demo that proves it", "socialProofAngle": "the testimonial structure that lands", "authorityProofAngle": "the clinical fields that back each step", "uniquenessClaim": "what only CelluMove can say" },
  "damagingAdmission": { "weakness": "an honest limitation", "howToFrame": "string", "trustPayoff": "why admitting it earns trust", "transitionToStrength": "string", "howItWorksSimple": "plain-language explainer", "whyNothingElseWorks": "string" },
  "primaryFalseBelief": { "belief": "what she wrongly believes", "origin": "where it came from", "ahaSentence": "the one-line reframe", "whyItsWrong": "string", "correctedBelief": "string", "emotionalWeight": "the feeling attached" },
  "supportingFalseBeliefs": [ { "belief": "string", "copyUse": "how to use it in copy", "whyWrong": "string" } ],
  "beliefVariations": { "forAds": "string", "forUgc": "string", "forVsl": "string", "forEmail": "subject-line options" },
  "rootCauseResearch": {
    "rawDataPoints": ["defensible facts/stats with their source named inline"],
    "hiddenRootCause": { "problemStatement": "string", "mechanismNarrative": "step-by-step of what's physically happening", "connectionToProduct": "how CelluMove addresses it", "whyNobodyTalksAboutIt": "string" },
    "evidence": [ { "summary": "string", "reference": "real citation if known, else describe the field", "credibility": "string", "sourceType": "study|clinical_data|forum_pattern|emerging_research" } ]
  },
  "marketSophistication": { "stage": 1-5, "stageName": "string", "evidence": ["competitor claims that prove the stage"], "competitorMechanisms": ["string"], "customerSkepticismLevel": "string", "recommendedStrategicResponse": "new_information|new_mechanism|new_identity + why" },
  "proofStack": [ { "type": "study|expert_quote|statistic|analogy|before_after", "content": "string", "simplified": "plain-language version", "emotionalImpact": "what it does for her" } ],
  "ahaMoment": { "setup": "the question that opens the loop", "reveal": "the answer", "implication": "what it means for her past failures", "fullAhaSentence": "string" },
  "objectionPreempts": [ { "objection": "in her words", "tone": "matter-of-fact|empathetic|curious", "response": "string" } ],
  "plainLanguageSummary": { "analogy": "string", "coffeeTest": "how she'd explain it to a friend", "oneSentence": "string", "oneParagraph": "string", "sixthGradeExplanation": "string" },
  "hooks": [ { "hook": "string", "type": "question|statement|reveal|confession|challenge", "scrollStopScore": 1-10 } ],
  "ugcTalkingPoints": { "do": ["string"], "dont": ["string"] }
}`,
    ].join("\n"),
  },
  {
    key: "brandDna",
    code: "DNA",
    title: "Brand DNA",
    role: "strategist",
    feature: "pipeline_dna_brand",
    blurb: "How CelluMove shows up in this funnel — positioning, USP, pillars, voice, and what we do/don't say.",
    needs: ["rootCause"],
    maxOutputTokens: 16384,
    instruction: [
      "You are running the BRAND DNA stage. Define how CelluMove should show up across THIS avatar's funnel.",
      "Anchor it to the root cause/mechanism from the previous stage and to the avatar's real voice.",
      "Capture: a positioning statement, the unique selling proposition, 3-5 brand pillars, voice & tone (how we speak to HER specifically),",
      "core values, a short origin / why-we-exist narrative, and explicit Do-Say / Don't-Say lists.",
      "The Don't-Say list MUST include the guardrail's banned words AND this avatar's rejected clichés.",
      CLAIMS_GUARDRAIL,
      'Return ONLY JSON: {"positioning":string,"usp":string,"pillars":string[],"voiceAndTone":string,"coreValues":string[],"originStory":string,"doSay":string[],"dontSay":string[]}',
    ].join("\n"),
  },
  {
    key: "copyArsenal",
    code: "G4",
    title: "Copy Arsenal",
    role: "copywriter",
    feature: "pipeline_g4_copy_arsenal",
    blurb: "A reusable bank of big ideas, headlines, leads, fascinations, hooks, CTAs, and objection crushers.",
    needs: ["rootCause", "brandDna", "avatarIntel"],
    maxOutputTokens: 32768,
    instruction: [
      "You are running the COPY ARSENAL stage. Build a reusable copy bank that every downstream asset draws from.",
      "Use the avatar's actual language (from her research + deep dive), the root cause/mechanism, and the brand DNA.",
      "Everything must sound like HER — never generic marketing, never a rejected cliché.",
      "Provide: big ideas, headlines, leads/openers, fascination bullets, scroll-stopping hooks, CTAs, objection crushers, and power phrases mined from her voice.",
      CLAIMS_GUARDRAIL,
      'Return ONLY JSON: {"bigIdeas":string[],"headlines":string[],"leads":string[],"fascinationBullets":string[],"hooks":string[],"ctas":string[],"objectionCrushers":[{"objection":string,"rebuttal":string}],"powerPhrases":string[]}',
    ].join("\n"),
  },
  {
    key: "advertorial",
    code: "G5",
    title: "Advertorial",
    role: "copywriter",
    feature: "pipeline_g5_advertorial",
    blurb: "A native-style advertorial article that carries her from problem-aware to ready-to-buy.",
    needs: ["rootCause", "brandDna", "copyArsenal"],
    maxOutputTokens: 32768,
    instruction: [
      "You are running the ADVERTORIAL stage. Write a native-style advertorial — it should read like editorial, not an ad —",
      "that takes the avatar from problem-aware to ready-to-buy. Build it on the root cause/mechanism, brand DNA, and copy arsenal.",
      "Story-led, specific, and in her voice. Open with a hook from the arsenal; weave in the mechanism and proof; close with a clear CTA.",
      CLAIMS_GUARDRAIL,
      'Return ONLY JSON: {"headline":string,"subheadline":string,"byline":string,"sections":[{"heading":string,"body":string}],"callToAction":string,"ps":string}',
    ].join("\n"),
  },
  {
    key: "adScripts",
    code: "G6",
    title: "Ad Scripts & Copy",
    role: "copywriter",
    feature: "pipeline_g6_ad_scripts",
    blurb: "Ready-to-shoot short-form video scripts plus Meta primary-text and headline variants.",
    needs: ["rootCause", "brandDna", "copyArsenal"],
    maxOutputTokens: 49152,
    instruction: [
      "You are running the AD SCRIPTS & COPY stage. Produce ready-to-shoot short-form video ad scripts AND Meta ad copy.",
      "Write 3-5 scripts, each with a DISTINCT hook mechanic (never variants of one idea), a 5-6 beat storyboard",
      "(time, visual, on-screen text, voiceover), and a CTA. Then give Meta primary-text variants and ad headlines.",
      "Pull hooks/phrases from the copy arsenal and keep the mechanism correct.",
      CLAIMS_GUARDRAIL,
      'Return ONLY JSON: {"scripts":[{"title":string,"hookMechanic":string,"hook":string,"beats":[{"time":string,"visual":string,"onScreenText":string,"voiceover":string}],"cta":string}],"primaryTexts":string[],"adHeadlines":string[]}',
    ].join("\n"),
  },
  {
    key: "creativeBriefs",
    code: "G7",
    title: "Creative Briefs",
    role: "designer",
    feature: "pipeline_g7_creative_briefs",
    blurb: "Shoot/design-ready briefs an editor or designer could execute without you.",
    needs: ["adScripts", "advertorial", "copyArsenal", "brandDna"],
    maxOutputTokens: 32768,
    instruction: [
      "You are running the CREATIVE BRIEFS stage. Turn the ad scripts + advertorial into shoot/design-ready creative briefs",
      "an editor or designer could execute WITHOUT you. One brief per creative.",
      "Each brief: a title, format (static or video), the concept, the key visual, the exact copy to use, a shot list,",
      "production notes, and the list of deliverables.",
      "When a B-ROLL LIBRARY is provided, name real clips from it EXACTLY in the shot list (prefer clips with a low or absent \"suggested N×\" count). For any shot with NO matching clip, add a fallback to productionNotes: a ready-to-run AI video-generation prompt AND a TikTok search query to scrap a similar clip.",
      CLAIMS_GUARDRAIL,
      'Return ONLY JSON: {"briefs":[{"title":string,"format":"static"|"video","concept":string,"keyVisual":string,"copyToUse":string,"shotList":string[],"productionNotes":string,"deliverables":string[]}]}',
    ].join("\n"),
  },
];

export function stageDef(key: PipelineStageKey): PipelineStageDef {
  const def = PIPELINE_STAGES.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown pipeline stage: ${key}`);
  return def;
}

// ─── Deep Dive (G2) scraping depth ────────────────────────────────────────────
// Three tiers of how many distinct source THREADS (Reddit posts / YouTube videos /
// forum pages) to read + mine. Each pass reads a batch of new threads and extracts
// verbatims from them; the loop runs automatically until the thread target is hit.
export type DeepDiveDepth = "soft" | "medium" | "high";

export interface DeepDiveDepthConfig {
  label: string;
  target: number;           // target distinct-thread count
  maxThreads: number;       // Reddit threads scraped per pass
  maxChars: number;         // Reddit chars per pass
  maxVideos: number;        // YouTube videos per pass
  maxComments: number;      // YouTube comments per video
  maxPasses: number;        // hard safety cap so the loop always terminates
  perPassOutputTokens: number;
}

export const DEEP_DIVE_DEPTHS: Record<DeepDiveDepth, DeepDiveDepthConfig> = {
  soft:   { label: "Soft · 100 threads",  target: 100,  maxThreads: 14, maxChars: 12000, maxVideos: 8,  maxComments: 10, maxPasses: 14, perPassOutputTokens: 32768 },
  medium: { label: "Medium · 500 threads", target: 500, maxThreads: 18, maxChars: 16000, maxVideos: 10, maxComments: 12, maxPasses: 45, perPassOutputTokens: 49152 },
  high:   { label: "High · 1000 threads", target: 1000, maxThreads: 20, maxChars: 18000, maxVideos: 12, maxComments: 14, maxPasses: 85, perPassOutputTokens: 49152 },
};

export function deepDiveDepthConfig(depth: DeepDiveDepth): DeepDiveDepthConfig {
  return DEEP_DIVE_DEPTHS[depth] ?? DEEP_DIVE_DEPTHS.soft;
}

// One PASS of the progressive deep dive: mine as many NEW real verbatims as this
// pass's material supports, excluding what earlier passes already collected.
export const DEEP_DIVE_PASS_INSTRUCTION = [
  "You are running ONE PASS of a progressive AVATAR DEEP DIVE for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche.",
  "Your job THIS pass: mine as many NEW, REAL verbatim quotes as possible about the target avatar — her exact words about pains, fears, desires, objections, daily struggles, identity, and trigger moments.",
  "You are given (a) freshly scraped raw material (Reddit threads + YouTube comments) for THIS pass, and (b) a sample of quotes ALREADY collected in earlier passes.",
  "",
  "RULES:",
  "• Every verbatim must be a real person's actual words, copied (near-)verbatim, WITH a real source URL. Never invent quotes or URLs.",
  "• Do NOT re-report any already-collected quote or a near-duplicate of one. Find NEW voices.",
  "• Prioritize the raw material provided, and ALSO run grounded searches (site:reddit.com, site:quora.com, site:youtube.com, niche forums) to open NEW threads and pull more real quotes.",
  "• BRAND RELEVANCE on YouTube/TikTok: anchor those searches to the PRODUCT, not just the topic — pair the avatar's problem with 'compression leggings' / '3D shaping leggings' / 'shapewear leggings' (reviews, before-and-afters, hauls, try-ons). A generic topic video that never touches compression/shaping leggings is NOT relevant here; skip it.",
  "• Go WIDE — different subreddits, videos, and threads each pass, so every pass surfaces fresh voices.",
  "• Classify each verbatim by category and note the theme it belongs to.",
  "• Return as MANY new verbatims as the material supports (aim for 60-150 this pass).",
  "• COVERAGE IS THE GOAL: in `threadsRead`, list EVERY distinct thread / video / page you actually read or analyzed this pass — both the ones provided below AND any you opened via search — each with its real URL. This is how we measure how many threads the deep dive has covered, so be complete.",
  "",
  "Return EXACTLY one JSON object — no prose, no markdown fences:",
  `{
  "avatar": "1-2 sentence who-she-is (only include if you can improve on what's known)",
  "threadsRead": [
    { "url": "https://...", "title": "the post/video/page title", "platform": "reddit|youtube|quora|forum|tiktok|amazon" }
  ],
  "verbatims": [
    { "text": "her exact words", "source": "https://...", "speaker": "OP|replier|commenter", "category": "pain|fear|desire|objection|daily_struggle|identity|trigger|transformation", "theme": "short theme label" }
  ],
  "bigPatterns": ["dominant shared beliefs / struggles / desires you saw THIS pass"],
  "painPoints": ["..."],
  "desires": ["..."],
  "fears": ["..."],
  "objections": ["..."],
  "dailyLanguage": ["exact phrases she uses"],
  "outliers": ["notable minority views"],
  "subredditsExplored": ["r/..."]
}`,
].join("\n");

// Final synthesis over the whole accumulated deep-dive corpus (runs once when the
// deep dive completes) → a decision-ready ANGLE brief. Closed-book over the provided
// research; grounded in her real words, never invented.
export const DEEP_DIVE_SYNTHESIS_INSTRUCTION = [
  "You are a top creative strategist for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche.",
  "You are given the accumulated AVATAR DEEP DIVE research for ONE angle: real patterns, verbatim customer quotes, and the threads that were read.",
  "Synthesize it into a tight, decision-ready ANGLE brief. Ground EVERY field in the research provided — use her real words and the patterns you see. Do not invent facts, quotes, or claims.",
  CLAIMS_GUARDRAIL,
  "",
  "Return EXACTLY one JSON object with these keys (no prose, no markdown fences):",
  `{
  "whoThisAngleSpeaksTo": "1-2 sentences — exactly who this angle is for",
  "biggestPain": "the #1 functional pain, in her framing",
  "emotionalPain": "the deeper emotional pain underneath it",
  "desiredOutcome": "the transformation she actually wants",
  "biggestMisconception": "the wrong belief keeping her stuck",
  "existingBeliefs": ["beliefs she already holds we can build on"],
  "objections": ["the real reasons she hesitates to buy"],
  "triggerMoments": ["specific moments that push her to look for a solution"],
  "hiddenEmotionalTruth": "the unspoken truth she rarely says out loud",
  "freshInsights": ["non-obvious insights from the research most marketers miss"],
  "competitorBlindSpots": ["what competitors get wrong or ignore for this avatar"],
  "whyOutperformsGeneric": "why this angle beats generic compression-legging creative",
  "positioningVariations": ["EXACTLY 5 distinct positioning statements for this angle"],
  "emotionalDirections": [ { "direction": "fear|hope|validation|curiosity", "approach": "how to enter from that emotion" } ],
  "messagingTerritories": ["EXACTLY 5 distinct messaging territories within this angle"],
  "singleStrongestInsight": "THE single strongest creative insight for this angle — the one thing to build the best ad around"
}`,
  "Give EXACTLY 5 positioningVariations, EXACTLY 3 emotionalDirections (the 3 strongest of fear/hope/validation/curiosity), and EXACTLY 5 messagingTerritories.",
].join("\n");
