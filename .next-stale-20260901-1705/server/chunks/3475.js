"use strict";exports.id=3475,exports.ids=[3475],exports.modules={43475:(a,b,c)=>{c.d(b,{L2:()=>e});let d="CLAIMS GUARDRAIL (non-negotiable): compression SUPPORTS and shapes — it does not cure, treat, melt, dissolve, or remove anything.\nNever use: cure / eliminate / melt / dissolve / gone / removes / permanent / detox.\nUse instead: 'smoother', 'the appearance of', 'less noticeable', 'feels firmer', 'supported', 'sculpted look'.\nStay inside the angle's own mechanism; never leak a banned mechanism from another angle.",e=[{key:"deepDive",code:"G2",title:"Avatar Deep Dive",role:"researcher",feature:"pipeline_g2_deep_dive",blurb:"Grounded Reddit deep-dive research — real threads, exact quotes, multiple perspectives, pattern-level insight.",needs:[],grounded:!0,maxOutputTokens:49152,thinkingBudget:8192,instruction:`You are a top creative strategist for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche. Your mission: a DEEP DIVE on the target customer (the avatar named in the task) to gain a real, emotional, data-backed understanding of our ideal audience — to uncover raw insights for killer ad angles, irresistible messaging, and content that deeply resonates and converts.
You are filling out an AVATAR DEEP DIVE RESEARCH document from REAL findings on Reddit.

HOW TO APPROACH THIS TASK:
• GO DEEP — no surface-level answers. Compile entire posts and threads that reflect what real people think, feel, and experience, in their own words.
• USE REAL CUSTOMER LANGUAGE — include exact quotes, especially phrases that show frustrations, fears, aspirations, and desires. These words are gold for ad copy and angles.
• ANALYZE MULTIPLE PERSPECTIVES — for every theme, include varied opinions, conversations, debates, and commentary. Get a well-rounded view, not one side.
• PRIORITIZE PATTERNS OVER OUTLIERS — find the big, shared beliefs, struggles, and desires that unite the audience; focus on common stories that keep recurring. Note real outliers separately.
• EXPLORE THE GIVEN SUBREDDITS AND GO BEYOND — follow rabbit holes into adjacent communities that fit the avatar's world.
• KEEP CONTEXT INTACT — don't just list quotes. Structure findings like real Reddit conversations: post titles, back-and-forth discussion, then a brief summary insight tying it back to the avatar's psychology.

════════════════════════════════════════════════════════════════════════
SOURCE DISCIPLINE — non-negotiable
════════════════════════════════════════════════════════════════════════
Prioritize Reddit. Run 8+ grounded queries mixing the avatar/angle keywords with: site:reddit.com, "reddit", "what helps", "tried everything", "finally", "anyone else", "my experience".
GO BEYOND REDDIT — also mine YouTube comment sections (real top comments are already provided below — quote them), Quora answers, and niche forums. For a YouTube source set the thread's "subreddit" to "YouTube" (or the channel) and the "url" to the video link; for Quora/forums use the page URL.
READ IN FULL — after searching, OPEN the most promising threads/pages with the url-context tool and read the ENTIRE thread (post + comments) before drafting. Snippets lie; the gold is in the back-and-forth.
Every thread you report MUST include its real reddit URL, and every quote must be the user's actual words from a thread you opened. Do NOT invent threads, quotes, or URLs.
REJECT SEO listicles, brand blogs, affiliate roundups, and AI content farms.

Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:
{
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
}`},{key:"avatarIntel",code:"AIR",title:"Avatar Intelligence Report",role:"strategist",feature:"pipeline_air_avatar_intel",blurb:"Synthesizes the G2 corpus into market intelligence — segments, ranked problems, emotions, triggers, opportunities, and 20 scored angles.",needs:["deepDive"],maxOutputTokens:49152,thinkingBudget:8192,instruction:["You are running the AVATAR INTELLIGENCE REPORT stage of the CelluMove pipeline.\nGOAL: understand the market before writing a single hook. This report is the strategic foundation every downstream stage (mechanism, copy, scripts) builds on.\n\nINPUTS — you are given the avatar's G1 research and the grounded G2 deep-dive corpus: its synthesis, big patterns, and a large bank of REAL verbatims (Reddit + YouTube). This stage is pure SYNTHESIS of that gathered research — no new web research.\nBase EVERY section on the corpus. Quote her real language from the verbatims. Never invent quotes, stats, segments, or facts the corpus doesn't support.\nCompetitor/alternative intel comes from the corpus itself — what she says she tried (SPANX, Skims, pharmacy stockings, creams…), what failed her, and why she distrusts it.",d,"\nProduce ALL sections:\n  1. AVATAR SUMMARY — who exactly is this customer?\n  2. AVATAR SEGMENTS — identify 10-20 distinct sub-avatars (e.g. 'Women whose legs became heavy after menopause'). Distinct = different life stage, context, trigger, or value driver.\n  3. CORE PROBLEMS — every major problem, RANKED, with why each matters.\n  4. EMOTIONAL PROBLEMS — the pain beneath the surface (identity loss, embarrassment, fear, grief, isolation, body betrayal…).\n  5. TRIGGER MOMENTS — every trigger (mirror, vacation, wedding, dressing room, summer, sock marks, old photos…).\n  6. EXISTING BELIEFS — what do they already believe?\n  7. OBJECTIONS — every objection.\n  8. DESIRED OUTCOMES — functional, emotional, identity, lifestyle.\n  9. HIDDEN INSIGHTS — emotional truths NOT directly stated in the research.\n  10. OPPORTUNITY SCORE — rank every opportunity: opportunity / score / why.\n  11. BEST ADVERTISING ANGLES — EXACTLY 20 angles. Each: name, which segment it targets, problem, emotion, awareness level, why it works, expected CTR (1-10), originality (1-10), Meta performance score (1-10).\n  12. Finally answer: if you had $500,000 to spend on Meta tomorrow, which 5 angles would you test first and why?\n\nReturn EXACTLY one JSON object — no prose, no markdown fences, no preamble:",`{
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
}`,"Give 10-20 segments, EXACTLY 20 angles, and EXACTLY 5 budget500kTestPlan picks (ordered by priority)."].join("\n")},{key:"rootCause",code:"G3",title:"Root Cause & Mechanism",role:"strategist",feature:"pipeline_g3_root_cause",blurb:"Villains + hierarchy, the unique mechanism with named steps & copy, belief work, proof stack, and objection preempts.",needs:["deepDive","avatarIntel"],maxOutputTokens:49152,thinkingBudget:8192,instruction:["You are running the ROOT CAUSE & MECHANISM stage of the CelluMove pipeline — the RMBC 'Mechanism' deliverable.\nProduce a COMPLETE Root Cause & Mechanism document for THIS avatar and angle, following the exact structure below.\nGenerate ALL content fresh from the avatar research + angle mechanism. Do NOT copy any example; the postpartum '2-Hour Compression Reset Protocol' is only an illustration of the DEPTH and FORMAT expected.\n\nQUALITY BAR (match this depth):\n  • Villains externalise blame onto a SYSTEM / HIDDEN ENEMY / SELF-SABOTEUR — never her body or her choices.\n  • The mechanism must EXPLAIN why everything she tried failed, and make CelluMove's fix feel inevitable once she gets the science.\n  • Use her real phrasing from the research. Be specific and falsifiable. Quote real moments (e.g. 'the 2pm bathroom adjustment').\n  • Ground the science in the angle's mechanism. Borrow authority from established clinical/physiological fields where honest.",d,"\nReturn EXACTLY one JSON object with these keys (omit a field only if you genuinely cannot ground it; never invent fake citations):",`{
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
}`].join("\n")},{key:"brandDna",code:"DNA",title:"Brand DNA",role:"strategist",feature:"pipeline_dna_brand",blurb:"How CelluMove shows up in this funnel — positioning, USP, pillars, voice, and what we do/don't say.",needs:["rootCause"],maxOutputTokens:16384,instruction:["You are running the BRAND DNA stage. Define how CelluMove should show up across THIS avatar's funnel.\nAnchor it to the root cause/mechanism from the previous stage and to the avatar's real voice.\nCapture: a positioning statement, the unique selling proposition, 3-5 brand pillars, voice & tone (how we speak to HER specifically),\ncore values, a short origin / why-we-exist narrative, and explicit Do-Say / Don't-Say lists.\nThe Don't-Say list MUST include the guardrail's banned words AND this avatar's rejected clich\xe9s.",d,'Return ONLY JSON: {"positioning":string,"usp":string,"pillars":string[],"voiceAndTone":string,"coreValues":string[],"originStory":string,"doSay":string[],"dontSay":string[]}'].join("\n")},{key:"copyArsenal",code:"G4",title:"Copy Arsenal",role:"copywriter",feature:"pipeline_g4_copy_arsenal",blurb:"A reusable bank of big ideas, headlines, leads, fascinations, hooks, CTAs, and objection crushers.",needs:["rootCause","brandDna","avatarIntel"],maxOutputTokens:32768,instruction:["You are running the COPY ARSENAL stage. Build a reusable copy bank that every downstream asset draws from.\nUse the avatar's actual language (from her research + deep dive), the root cause/mechanism, and the brand DNA.\nEverything must sound like HER — never generic marketing, never a rejected clich\xe9.\nProvide: big ideas, headlines, leads/openers, fascination bullets, scroll-stopping hooks, CTAs, objection crushers, and power phrases mined from her voice.",d,'Return ONLY JSON: {"bigIdeas":string[],"headlines":string[],"leads":string[],"fascinationBullets":string[],"hooks":string[],"ctas":string[],"objectionCrushers":[{"objection":string,"rebuttal":string}],"powerPhrases":string[]}'].join("\n")},{key:"advertorial",code:"G5",title:"Advertorial",role:"copywriter",feature:"pipeline_g5_advertorial",blurb:"A native-style advertorial article that carries her from problem-aware to ready-to-buy.",needs:["rootCause","brandDna","copyArsenal"],maxOutputTokens:32768,instruction:["You are running the ADVERTORIAL stage. Write a native-style advertorial — it should read like editorial, not an ad —\nthat takes the avatar from problem-aware to ready-to-buy. Build it on the root cause/mechanism, brand DNA, and copy arsenal.\nStory-led, specific, and in her voice. Open with a hook from the arsenal; weave in the mechanism and proof; close with a clear CTA.",d,'Return ONLY JSON: {"headline":string,"subheadline":string,"byline":string,"sections":[{"heading":string,"body":string}],"callToAction":string,"ps":string}'].join("\n")},{key:"adScripts",code:"G6",title:"Ad Scripts & Copy",role:"copywriter",feature:"pipeline_g6_ad_scripts",blurb:"Ready-to-shoot short-form video scripts plus Meta primary-text and headline variants.",needs:["rootCause","brandDna","copyArsenal"],maxOutputTokens:49152,instruction:["You are running the AD SCRIPTS & COPY stage. Produce ready-to-shoot short-form video ad scripts AND Meta ad copy.\nWrite 3-5 scripts, each with a DISTINCT hook mechanic (never variants of one idea), a 5-6 beat storyboard\n(time, visual, on-screen text, voiceover), and a CTA. Then give Meta primary-text variants and ad headlines.\nPull hooks/phrases from the copy arsenal and keep the mechanism correct.",d,'Return ONLY JSON: {"scripts":[{"title":string,"hookMechanic":string,"hook":string,"beats":[{"time":string,"visual":string,"onScreenText":string,"voiceover":string}],"cta":string}],"primaryTexts":string[],"adHeadlines":string[]}'].join("\n")},{key:"creativeBriefs",code:"G7",title:"Creative Briefs",role:"designer",feature:"pipeline_g7_creative_briefs",blurb:"Shoot/design-ready briefs an editor or designer could execute without you.",needs:["adScripts","advertorial","copyArsenal","brandDna"],maxOutputTokens:32768,instruction:['You are running the CREATIVE BRIEFS stage. Turn the ad scripts + advertorial into shoot/design-ready creative briefs\nan editor or designer could execute WITHOUT you. One brief per creative.\nEach brief: a title, format (static or video), the concept, the key visual, the exact copy to use, a shot list,\nproduction notes, and the list of deliverables.\nWhen a B-ROLL LIBRARY is provided, name real clips from it EXACTLY in the shot list (prefer clips with a low or absent "suggested N\xd7" count). For any shot with NO matching clip, add a fallback to productionNotes: a ready-to-run AI video-generation prompt AND a TikTok search query to scrap a similar clip.',d,'Return ONLY JSON: {"briefs":[{"title":string,"format":"static"|"video","concept":string,"keyVisual":string,"copyToUse":string,"shotList":string[],"productionNotes":string,"deliverables":string[]}]}'].join("\n")}];["You are a top creative strategist for a $100M/year direct-response brand in the 3D-shaping / sculpting / compression-legging niche.\nYou are given the accumulated AVATAR DEEP DIVE research for ONE angle: real patterns, verbatim customer quotes, and the threads that were read.\nSynthesize it into a tight, decision-ready ANGLE brief. Ground EVERY field in the research provided — use her real words and the patterns you see. Do not invent facts, quotes, or claims.",d,"\nReturn EXACTLY one JSON object with these keys (no prose, no markdown fences):",`{
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
}`,"Give EXACTLY 5 positioningVariations, EXACTLY 3 emotionalDirections (the 3 strongest of fear/hope/validation/curiosity), and EXACTLY 5 messagingTerritories."].join("\n")}};