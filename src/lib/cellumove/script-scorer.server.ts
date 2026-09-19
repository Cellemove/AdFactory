import "server-only";

import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { loadMinedAds } from "@/lib/cellumove/corpus/mine.server";
import { extractJsonObject, runAgent } from "@/lib/cellumove/agents";
import { cosine, embedTexts } from "@/lib/cellumove/embeddings";
import { extractAnalyzedScript } from "@/lib/cellumove/script-scorer-extraction.server";
import {
  GROUNDING_THRESHOLD,
  SCORER_BASELINE_VERSION,
  SCORER_ENGINE_VERSION,
  SCORER_EXTRACTOR_PROMPT_VERSION,
  SCORER_TAXONOMY_VERSION,
  ScorerLayerSchema,
  scoreFactVerification,
  scoreObserverFlags,
  scoreSpecificity,
  scoreStructuralFit,
  judgeScoreImprovement,
  stabilizedFactScore,
  scoreVerbatimGrounding,
  scorerInputHash,
  type AnalyzedScript,
  type ApprovedEvidence,
  type GoldAdInput,
  type GroundingMatch,
  type ScriptScorerModuleResult,
} from "@/lib/cellumove/script-scorer";
import { inspectScriptQuality, parseScriptDocument, type ScriptDocument } from "@/lib/cellumove/script-studio";
import type {
  AngleRow,
  BrandFactRow,
  CopyTaxonomyCodeRow,
  GoldAdRow,
  GoldBeatRow,
  Json,
  ProductOfferRow,
  ProductRow,
  ScriptProjectRow,
  ScriptScoreFindingRow,
  ScriptScoreModuleRow,
  ScriptScoreRunRow,
  ScriptVersionRow,
  SubAvatarRow,
} from "@/lib/database.types";
import { newId, supabase, unwrapOpt } from "@/lib/db";
import { FAST_MODEL } from "@/lib/llm";

export type ScriptScoreResult = {
  run: ScriptScoreRunRow;
  modules: ScriptScoreModuleRow[];
  findings: ScriptScoreFindingRow[];
  scriptSnapshot: ScriptDocument;
};

type ScoreContext = {
  document: ScriptDocument;
  project: ScriptProjectRow;
  version: ScriptVersionRow;
  product: ProductRow;
  angle: AngleRow;
  avatar: SubAvatarRow | null;
  marketCode: string;
};

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/taxonomy|schema cache|relation .* does not exist/i.test(message)) return "SCORER_NOT_CONFIGURED";
  if (/Gemini|Extractor|LLM|GOOGLE_CLOUD_PROJECT/i.test(message)) return "EXTRACTION_FAILED";
  return "SCORER_FAILED";
}

async function loadContext(projectId: string, scriptVersion: number, marketCode: string): Promise<ScoreContext> {
  const [projectRaw, versionRaw] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", projectId).maybeSingle()),
    unwrapOpt(await supabase.from("ScriptVersion").select("*").eq("projectId", projectId).eq("version", scriptVersion).maybeSingle()),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  const version = versionRaw as ScriptVersionRow | null;
  if (!project) throw new Error("Script project not found.");
  if (!version) throw new Error(`Immutable ScriptVersion ${scriptVersion} was not found.`);
  const [productRaw, angleRaw, avatarRaw] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", project.productId).maybeSingle()),
    unwrapOpt(await supabase.from("Angle").select("*").eq("id", project.angleId).maybeSingle()),
    project.subAvatarId
      ? unwrapOpt(await supabase.from("SubAvatar").select("*").eq("id", project.subAvatarId).maybeSingle())
      : null,
  ]);
  const product = productRaw as ProductRow | null;
  const angle = angleRaw as AngleRow | null;
  const avatar = avatarRaw as SubAvatarRow | null;
  if (!product || !angle) throw new Error("The script's product or angle is missing.");
  const document = parseScriptDocument(version.document);
  if (document.product.id !== project.productId || document.angle.id !== project.angleId) {
    throw new Error("The immutable version does not match its ScriptProject context.");
  }
  return { document, project, version, product, angle, avatar, marketCode };
}

async function loadGoldAds(angleSlug: string): Promise<GoldAdInput[]> {
  const adsResult = await supabase.from("GoldAd").select("*")
    .eq("baselineVersion", SCORER_BASELINE_VERSION)
    .eq("taxonomyVersion", SCORER_TAXONOMY_VERSION)
    .eq("angleSlug", angleSlug);
  if (adsResult.error) throw new Error(adsResult.error.message);
  const ads = (adsResult.data ?? []) as GoldAdRow[];
  if (!ads.length) return [];
  const beatsResult = await supabase.from("GoldBeat").select("*").in("goldAdId", ads.map((ad) => ad.id)).order("orderIndex");
  if (beatsResult.error) throw new Error(beatsResult.error.message);
  const beats = (beatsResult.data ?? []) as GoldBeatRow[];
  return ads.map((ad) => ({
    id: ad.id,
    angleSlug: ad.angleSlug,
    format: ad.format,
    beats: beats.filter((beat) => beat.goldAdId === ad.id).flatMap((beat) => {
      const layer = ScorerLayerSchema.safeParse(beat.layer);
      return layer.success ? [{ code: beat.code, layer: layer.data, orderIndex: beat.orderIndex, startSec: beat.startSec, endSec: beat.endSec }] : [];
    }),
  }));
}

/**
 * The Corpus Miner's fully broken-down winning ads, as Structure references. They
 * carry no CelluMove angle, so they are matched by production format only, and
 * every newly extracted ad joins automatically. Fail-soft: without them Structure
 * just has no fallback, rather than the whole score run failing.
 * ponytail: every brand in the corpus counts; filter by brand if an off-category
 * brand is ever mined.
 */
async function loadCorpusReferenceAds(): Promise<GoldAdInput[]> {
  try {
    const ads = await loadMinedAds(SCORER_TAXONOMY_VERSION);
    return ads.map((ad) => ({
      id: ad.id,
      angleSlug: "",
      format: ad.formatTag ?? "",
      beats: ad.beats.flatMap((beat) => {
        const layer = ScorerLayerSchema.safeParse(beat.layer);
        return layer.success ? [{ code: beat.code, layer: layer.data, orderIndex: beat.orderIndex, startSec: beat.startSec, endSec: beat.endSec }] : [];
      }),
    }));
  } catch (error) {
    console.warn("[scorer] corpus reference ads unavailable:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

type VerbatimCohort = {
  count: number;
  name: "verified_library" | null;
  subAvatarId: string | null;
  angleSlug: string | null;
  market: string | null;
};

async function countVerbatims(filters: { subAvatarId?: string; angleSlug?: string; market?: string } = {}): Promise<number> {
  let query = supabase.from("Verbatim").select("id", { count: "exact", head: true })
    .like("researchId", "verified:%")
    .not("embedding", "is", null);
  if (filters.subAvatarId) query = query.eq("subAvatarId", filters.subAvatarId);
  if (filters.angleSlug) query = query.eq("angleSlug", filters.angleSlug);
  if (filters.market) query = query.ilike("market", filters.market);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

async function selectVerbatimCohort(): Promise<VerbatimCohort> {
  // Every verified verbatim is the same product's audience, and the words a script
  // should echo are often filed under a sibling angle: a varicose-veins script says
  // "heavy, achy legs", which lives under heavy-legs, while the varicose-veins
  // verbatims are mostly about vein surgery. Measured 2026-09-19 on one script:
  // 1 of 12 lines grounded inside its angle, 4 of 12 against the library, and
  // unrelated lines still pass 0% at the 0.72 threshold. So the library is the pool.
  const library = await countVerbatims({});
  return { count: library, name: library >= 10 ? "verified_library" : null, subAvatarId: null, angleSlug: null, market: null };
}

async function runGrounding(context: ScoreContext, analysis: AnalyzedScript): Promise<ScriptScorerModuleResult> {
  let cohort: VerbatimCohort;
  try {
    cohort = await selectVerbatimCohort();
  } catch (error) {
    return {
      module: "verbatim_grounding", status: "failed", score: null,
      label: "Verified-verbatim grounding — experimental",
      summary: `Verbatim retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
      metrics: { threshold: GROUNDING_THRESHOLD }, findings: [],
    };
  }
  if (cohort.count < 10) return scoreVerbatimGrounding({ matches: [], candidateCount: cohort.count, cohort: cohort.name });
  const eligible = analysis.lines.filter((line) => ["H", "Q", "P", "B"].includes(line.layer));
  const embeddings = await embedTexts(eligible.map((line) => line.text));
  if (!embeddings || embeddings.length !== eligible.length || embeddings.some((embedding) => embedding.length !== 768)) {
    return {
      module: "verbatim_grounding", status: "failed", score: null,
      label: "Verified-verbatim grounding — experimental",
      summary: "The embedding service was unavailable or returned an incompatible vector.",
      metrics: { candidateCount: cohort.count, cohort: cohort.name, threshold: GROUNDING_THRESHOLD }, findings: [],
    };
  }
  // Retrieve the closest whole comments, then compare the script line with each
  // SENTENCE inside them. A script line is one sentence and a Reddit comment is
  // several, so line-vs-whole-comment understates real reuse. Measured on
  // 2026-09-19 at the 0.72 threshold: customer wording reused in ad voice passes
  // 88% sentence-level vs 68% whole-comment; unrelated lines pass 0% either way.
  const retrieved = await Promise.all(eligible.map(async (_line, index) => {
    const response = await supabase.rpc("match_verbatims", {
      query_embedding: `[${embeddings[index]!.join(",")}]`,
      match_count: GROUNDING_RERANK_COMMENTS,
      filter_sub_avatar_id: cohort.subAvatarId,
      filter_angle_slug: cohort.angleSlug,
      filter_market: cohort.market,
    });
    if (response.error) throw new Error(response.error.message);
    return (response.data ?? []) as Array<{ id: string; text: string; similarity: number }>;
  }));
  const sentencePool = [...new Set(retrieved.flat().flatMap((comment) => verbatimSentences(comment.text)))];
  const sentenceEmbeddings = sentencePool.length ? await embedTexts(sentencePool) : [];
  const sentenceVector = new Map(sentencePool.map((sentence, index) => [sentence, sentenceEmbeddings?.[index] ?? []]));
  const matched = eligible.map((line, index): GroundingMatch => {
    const whole = retrieved[index]![0];
    let best = { evidenceId: whole?.id ?? null, evidenceQuote: whole?.text ?? null, similarity: whole?.similarity ?? null };
    const ranked: Array<{ sentence: string; similarity: number }> = [];
    for (const comment of retrieved[index]!) {
      for (const sentence of verbatimSentences(comment.text)) {
        const vector = sentenceVector.get(sentence);
        const similarity = vector?.length ? cosine(embeddings[index]!, vector) : 0;
        ranked.push({ sentence, similarity });
        if (similarity > (best.similarity ?? 0)) best = { evidenceId: comment.id, evidenceQuote: sentence, similarity };
      }
    }
    const alternatives = [...new Set(ranked.sort((a, b) => b.similarity - a.similarity).map((item) => item.sentence))].filter((sentence) => sentence !== best.evidenceQuote).slice(0, 2);
    return { line, ...best, alternatives };
  });
  return scoreVerbatimGrounding({ matches: matched, candidateCount: cohort.count, cohort: cohort.name });
}

const GROUNDING_RERANK_COMMENTS = 5;

/** Sentences of a customer comment worth comparing: at least five words, not a wall of text. */
function verbatimSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.split(/\s+/).length >= 5 && sentence.length <= 240);
}

async function loadApprovedEvidence(context: ScoreContext): Promise<ApprovedEvidence[]> {
  const now = Date.now();
  const [factsResult, offersResult] = await Promise.all([
    supabase.from("BrandFact").select("*").eq("productId", context.product.id).eq("status", "approved"),
    supabase.from("ProductOffer").select("*").eq("productId", context.product.id).eq("status", "approved"),
  ]);
  if (factsResult.error) throw new Error(factsResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  const facts = (factsResult.data ?? []) as BrandFactRow[];
  const offers = (offersResult.data ?? []) as ProductOfferRow[];
  const appliesToMarket = (market: string | null) => !market || market.toUpperCase() === context.marketCode.toUpperCase();
  return [
    ...facts.filter((fact) => appliesToMarket(fact.marketCode)).map((fact) => ({ id: fact.id, type: "brand_fact" as const, text: fact.statement })),
    ...offers.filter((offer) => appliesToMarket(offer.marketCode)
      && (!offer.validFrom || Date.parse(offer.validFrom) <= now)
      && (!offer.validUntil || Date.parse(offer.validUntil) >= now))
      .map((offer) => ({ id: offer.id, type: "product_offer" as const, text: offer.statement })),
  ];
}

async function persistResults(runId: string, results: ScriptScorerModuleResult[]): Promise<void> {
  const moduleInsert = await supabase.from("ScriptScoreModule").insert(results.map((result) => ({
    runId,
    module: result.module,
    status: result.status,
    score: result.score,
    label: result.label,
    summary: result.summary,
    metrics: asJson(result.metrics),
  })));
  if (moduleInsert.error) throw new Error(moduleInsert.error.message);
  const findings = results.flatMap((result) => result.findings.map((finding) => ({
    id: newId(),
    runId,
    module: finding.module,
    severity: finding.severity,
    scriptModuleId: finding.scriptModuleId,
    lineIndex: finding.lineIndex,
    scriptQuote: finding.scriptQuote,
    message: finding.message,
    recommendation: finding.recommendation,
    evidenceType: finding.evidenceType,
    evidenceId: finding.evidenceId,
    evidenceQuote: finding.evidenceQuote,
    similarity: finding.similarity,
    metadata: asJson(finding.metadata ?? {}),
  })));
  if (findings.length) {
    const findingInsert = await supabase.from("ScriptScoreFinding").insert(findings);
    if (findingInsert.error) throw new Error(findingInsert.error.message);
  }
}

/**
 * Score one document. Writes nothing (apart from Usage rows): the saved run and an
 * AI-edited candidate (proposeScoreImprovement) are both judged by exactly this.
 */
async function scoreDocument(context: ScoreContext, document: ScriptDocument, usageRunId: string) {
  const taxonomyResult = await supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION).order("code");
  if (taxonomyResult.error) throw new Error(taxonomyResult.error.message);
  const taxonomy = (taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[];
  const analysis = await extractAnalyzedScript({ document, taxonomy, runId: usageRunId, marketCode: context.marketCode });
  const [goldAds, corpusAds, grounding, approvedEvidence] = await Promise.all([
    loadGoldAds(context.angle.slug),
    loadCorpusReferenceAds(),
    runGrounding(context, analysis),
    loadApprovedEvidence(context),
  ]);
  const results = [
    scoreStructuralFit({ document, analysis, goldAds, corpusAds, angleSlug: context.angle.slug, format: document.format }),
    grounding,
    scoreSpecificity(analysis),
    scoreFactVerification({ analysis, evidence: approvedEvidence }),
    scoreObserverFlags({ document, analysis }),
  ];
  return { taxonomy, analysis, results, goldAds, approvedEvidence, grounding };
}

export async function createScriptScoreRun(input: {
  projectId: string;
  scriptVersion: number;
  marketCode: string;
  force?: boolean;
  actor: SessionUser;
}): Promise<{ runId: string; reused: boolean }> {
  const context = await loadContext(input.projectId, input.scriptVersion, input.marketCode);
  const hash = scorerInputHash({
    document: context.document,
    marketCode: context.marketCode,
    productId: context.product.id,
    angleId: context.angle.id,
    subAvatarId: context.project.subAvatarId,
  });
  const baseRunKey = createHash("sha256").update([
    context.project.id,
    context.version.version,
    hash,
    SCORER_ENGINE_VERSION,
    SCORER_EXTRACTOR_PROMPT_VERSION,
    SCORER_TAXONOMY_VERSION,
    SCORER_BASELINE_VERSION,
  ].join(":" )).digest("hex");
  if (!input.force) {
    const existing = unwrapOpt(await supabase.from("ScriptScoreRun").select("*").eq("runKey", baseRunKey).maybeSingle()) as ScriptScoreRunRow | null;
    if (existing) return { runId: existing.id, reused: true };
  }
  const runId = newId();
  const runKey = input.force ? `${baseRunKey}:${runId}` : baseRunKey;
  const now = new Date().toISOString();
  const contextSnapshot = asJson({
    document: context.document,
    project: {
      id: context.project.id,
      title: context.project.title,
      displayName: context.project.displayName,
      format: context.project.format,
      productId: context.project.productId,
      angleId: context.project.angleId,
      subAvatarId: context.project.subAvatarId,
    },
    product: { id: context.product.id, name: context.product.name, code: context.product.code ?? null },
    angle: { id: context.angle.id, slug: context.angle.slug, name: context.angle.name },
    avatar: context.avatar ? { id: context.avatar.id, name: context.avatar.name } : null,
    marketCode: context.marketCode,
  });
  const runInsert = await supabase.from("ScriptScoreRun").insert({
    id: runId,
    runKey,
    projectId: context.project.id,
    scriptVersion: context.version.version,
    status: "running",
    marketCode: context.marketCode,
    inputHash: hash,
    engineVersion: SCORER_ENGINE_VERSION,
    extractorPromptVersion: SCORER_EXTRACTOR_PROMPT_VERSION,
    taxonomyVersion: SCORER_TAXONOMY_VERSION,
    baselineVersion: SCORER_BASELINE_VERSION,
    model: FAST_MODEL,
    createdByUserId: input.actor.id,
    startedAt: now,
    contextSnapshot,
    createdAt: now,
  }).select("*").single();
  if (runInsert.error) {
    if (!input.force && /duplicate|unique|runKey/i.test(runInsert.error.message)) {
      const raced = unwrapOpt(await supabase.from("ScriptScoreRun").select("*").eq("runKey", baseRunKey).maybeSingle()) as ScriptScoreRunRow | null;
      if (raced) return { runId: raced.id, reused: true };
    }
    throw new Error(runInsert.error.message);
  }
  try {
    const { analysis, results, goldAds, approvedEvidence, grounding } = await scoreDocument(context, context.document, runId);
    const auditedContext = asJson({
      ...(contextSnapshot as Record<string, Json | undefined>),
      analysis,
      scoreInputs: {
        goldAds,
        approvedEvidence,
        grounding: grounding.metrics,
      },
    });
    const auditWrite = await supabase.from("ScriptScoreRun").update({ contextSnapshot: auditedContext }).eq("id", runId);
    if (auditWrite.error) throw new Error(auditWrite.error.message);
    await persistResults(runId, results);
    const completedAt = new Date().toISOString();
    const completed = await supabase.from("ScriptScoreRun").update({ status: "complete", completedAt }).eq("id", runId);
    if (completed.error) throw new Error(completed.error.message);
    await supabase.from("ScriptEvent").insert({
      id: newId(), projectId: context.project.id, actorUserId: input.actor.id, eventType: "script_scored",
      payload: asJson({ runId, scriptVersion: context.version.version, marketCode: context.marketCode, engineVersion: SCORER_ENGINE_VERSION }),
      createdAt: completedAt,
    });
    return { runId, reused: false };
  } catch (error) {
    await supabase.from("ScriptScoreRun").update({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorCode: errorCode(error),
      errorSummary: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    }).eq("id", runId);
    throw error;
  }
}

export async function getScriptScoreRun(runId: string): Promise<ScriptScoreResult | null> {
  const run = unwrapOpt(await supabase.from("ScriptScoreRun").select("*").eq("id", runId).maybeSingle()) as ScriptScoreRunRow | null;
  if (!run) return null;
  const [modulesResult, findingsResult] = await Promise.all([
    supabase.from("ScriptScoreModule").select("*").eq("runId", runId),
    supabase.from("ScriptScoreFinding").select("*").eq("runId", runId).order("lineIndex", { ascending: true }),
  ]);
  if (modulesResult.error) throw new Error(modulesResult.error.message);
  if (findingsResult.error) throw new Error(findingsResult.error.message);
  const snapshot = run.contextSnapshot as Record<string, unknown>;
  return {
    run,
    modules: (modulesResult.data ?? []) as ScriptScoreModuleRow[],
    findings: (findingsResult.data ?? []) as ScriptScoreFindingRow[],
    scriptSnapshot: parseScriptDocument(snapshot.document),
  };
}

// ─── Improve score ───────────────────────────────────────────────────────────

const IMPROVE_MAX_MODULES = 5;
// Word room per beat. Generous on purpose: the app already stretches a beat's
// timing to fit longer copy, so length is a style guard, not a correctness one. A
// beat outside the range is REVERTED to its original (see below), it never costs
// the whole attempt — a 5-word overrun once threw away an otherwise good edit.
const IMPROVE_MAX_LENGTH_CHANGE = 0.4;
const IMPROVE_MIN_WORD_ROOM = 20;
const IMPROVE_MAX_ATTEMPTS = 2;
// An attempt is one Pro edit plus at most two re-scores (~100s).
const IMPROVE_TIME_BUDGET_MS = 130_000;
function allowedWords(current: number): { min: number; max: number } {
  const room = Math.max(IMPROVE_MIN_WORD_ROOM, Math.round(current * IMPROVE_MAX_LENGTH_CHANGE));
  return { min: Math.max(5, current - room), max: current + room };
}
export const SCRIPT_SCORE_IMPROVE_PROMPT_VERSION = "script-score-improve-v2";

export type ScoreImprovementModule = { id: string; spokenText: string; onScreenText: string; visualDirection: string };
export type ScoreImprovement = {
  accepted: boolean;
  before: Record<string, number | null>;
  after: Record<string, number | null> | null;
  modules: ScoreImprovementModule[];
  reasons: string[];
  /** Beats whose edit was dropped because it lowered a score; the rest were kept. */
  reverted: string[];
  /** Claims no approved record backs. The AI may not invent support: if one is true, approve it as a fact. */
  unverifiedClaims: string[];
  attempts: number;
};

const IMPROVE_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, spokenText: { type: "string" }, onScreenText: { type: "string" }, visualDirection: { type: "string" } },
        required: ["id", "spokenText", "onScreenText", "visualDirection"],
      },
    },
  },
  required: ["modules"],
} as const;

const IMPROVE_INSTRUCTION = [
  "You edit an existing ad script so that four automatic checks score higher. You are an editor, not a rewriter: change only the listed target modules, and inside them only the lines the findings name, plus the minimum around them to keep the copy flowing.",
  "HOW FACTS IS SCORED — read this first. Facts = supported claims divided by ALL checkable claims. Any sentence that states what the product is, does, contains, costs, guarantees, or achieves is a checkable claim, including a casual one. So adding a new product statement that no approved record backs LOWERS the score, and so does rewording a claim that was already supported.",
  "- facts.keepExactly: these sentences are already supported. Copy each one into your output word for word. Do not improve them.",
  "- Do not write the words guarantee, guaranteed, proven, clinically, or a number, unless an approved record you are restating contains them.",
  "- facts.unsupported: each item carries closestApprovedRecord. If that record covers the same point, restate the claim so it says what the record says (same number, same term). If it does not, delete the specific claim and leave a true, non-specific sentence that makes no product claim. Never invent numbers, studies, timeframes, testimonials or credentials, and never add a product statement that is not in facts.approved.",
  "- Grounding: for each grounding.weakLines item, rewrite the line so it says what one of its customerSentences says, in nearly that customer's own words (change I/my to you/your, or she/her in a story). These are lines about the PROBLEM and the person's life before the product — keep them that way. The customers were not talking about this product: never turn their words into a statement about what this product does, or into a story of someone using, missing, or being recommended this product. Use only the customer sentences supplied. Never present them as quotes or testimonials.",
  "- Specificity: replace each specificity.genericLines item with a concrete moment, object, action or sensation taken from the supplied customer sentences. Do not invent specifics and do not add product claims to be specific.",
  "- Structure: if structure.missingBeats lists beats, work each into the most fitting target module in roughly the expected order, in one or two sentences, obeying the Facts rules above.",
  "Each target module states allowedSpokenWords {min,max}: land inside it by trading words rather than only adding them. Keep each module's purpose, the script's angle, voice and person (first, second or third), and keep onScreenText to eight words or fewer.",
  "If previousAttempt is present, it names the exact sentences that were refused and why. Fix those and keep everything else from that attempt.",
  "Return JSON only: {\"modules\":[{\"id\":\"target module id\",\"spokenText\":\"...\",\"onScreenText\":\"...\",\"visualDirection\":\"...\"}]} containing every target module exactly once and no other module.",
].join("\n");

const spokenWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const isProblem = (severity: string) => severity !== "info";

type AnyFinding = { module: string; severity: string; scriptModuleId: string | null; scriptQuote: string | null };

/** Per beat: how many problems each scorer module reports, and how many claims it has supported. */
function beatLedger(findings: AnyFinding[]) {
  const problems = new Map<string, number>();
  const supported = new Map<string, number>();
  for (const finding of findings) {
    if (!finding.scriptModuleId) continue;
    if (isProblem(finding.severity)) {
      const key = `${finding.scriptModuleId}|${finding.module}`;
      problems.set(key, (problems.get(key) ?? 0) + 1);
    } else if (finding.module === "fact_verification") {
      supported.set(finding.scriptModuleId, (supported.get(finding.scriptModuleId) ?? 0) + 1);
    }
  }
  return { problems, supported };
}

/**
 * Ask the model for a targeted edit that raises the scorer's numbers, then PROVE
 * it on the same scorer before anyone sees it. Nothing is saved: an accepted edit
 * is returned for the strategist to apply as unsaved changes.
 *
 * It is not all-or-nothing. When the re-score is refused, the beats whose edit made
 * a falling check worse (or lost a supported claim) are reverted to the original
 * and the rest is re-scored — so one bad beat cannot discard three good ones. What
 * is still refused goes back to the model with the exact offending sentences.
 */
export async function proposeScoreImprovement(input: { runId: string; actor: SessionUser }): Promise<ScoreImprovement> {
  const scored = await getScriptScoreRun(input.runId);
  if (!scored || scored.run.status !== "complete") throw new Error("Score the script first; only a completed score run can be improved.");
  const context = await loadContext(scored.run.projectId, scored.run.scriptVersion, scored.run.marketCode);
  const document = context.document;
  const before = Object.fromEntries(scored.modules.map((module) => [module.module, module.score == null ? null : Number(module.score)]));

  const unverified = (findings: AnyFinding[]) => [...new Set(findings.filter((finding) => finding.module === "fact_verification" && isProblem(finding.severity) && finding.scriptQuote).map((finding) => finding.scriptQuote!))];
  const unverifiedNow = unverified(scored.findings);

  // The beats with the most real problems, unlocked only. "info" findings mark a
  // line that is ALREADY fine (supported / grounded) and must never count as one.
  const locked = new Set(document.modules.filter((module) => module.locked).map((module) => module.id));
  // A wrong claim outranks a vague line: one unsupported claim weighs as much as
  // several grounding warnings, or the fact problems never make the cut.
  const weight: Record<string, number> = { critical: 3, warning: 2 };
  const pressure = new Map<string, number>();
  for (const finding of scored.findings) {
    if (!finding.scriptModuleId || locked.has(finding.scriptModuleId) || finding.module === "observer_flags" || !isProblem(finding.severity)) continue;
    const factor = finding.module === "fact_verification" ? 4 : 1;
    pressure.set(finding.scriptModuleId, (pressure.get(finding.scriptModuleId) ?? 0) + factor * (weight[finding.severity] ?? 1));
  }
  const targetIds = [...pressure].sort((a, b) => b[1] - a[1]).slice(0, IMPROVE_MAX_MODULES).map(([id]) => id);
  if (!targetIds.length) return { accepted: false, before, after: null, modules: [], reasons: ["The scorer reported nothing fixable on an unlocked beat."], reverted: [], unverifiedClaims: unverifiedNow, attempts: 0 };
  const targets = new Set(targetIds);
  const inTargets = (module: string) => scored.findings.filter((finding) => finding.module === module && finding.scriptModuleId && targets.has(finding.scriptModuleId));
  const problemsFor = (module: string) => inTargets(module).filter((finding) => isProblem(finding.severity));
  const labelOf = new Map(document.modules.map((module) => [module.id, module.label]));

  const structure = scored.modules.find((module) => module.module === "structural_fit")?.metrics as { expectedCodes?: string[]; actualCodes?: string[] } | undefined;
  const present = new Set(structure?.actualCodes ?? []);
  const missingCodes = (structure?.expectedCodes ?? []).filter((code) => !present.has(code));
  const missingBeats = missingCodes.length
    ? ((await supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION).in("code", missingCodes)).data ?? []) as CopyTaxonomyCodeRow[]
    : [];
  const approved = await loadApprovedEvidence(context);

  const brief = {
    currentScores: before,
    targetModules: document.modules.filter((module) => targets.has(module.id)).map((module) => ({
      id: module.id, label: module.label, kind: module.kind, seconds: module.durationSec, currentWords: spokenWords(module.spokenText), allowedSpokenWords: allowedWords(spokenWords(module.spokenText)),
      spokenText: module.spokenText, onScreenText: module.onScreenText, visualDirection: module.visualDirection,
    })),
    readOnlyContext: document.modules.filter((module) => !targets.has(module.id)).map((module) => ({ id: module.id, label: module.label, spokenText: module.spokenText })),
    grounding: {
      weakLines: problemsFor("verbatim_grounding").filter((finding) => finding.evidenceQuote).map((finding) => {
        const alternatives = (finding.metadata as { alternatives?: unknown } | null)?.alternatives;
        return { moduleId: finding.scriptModuleId, line: finding.scriptQuote, customerSentences: [...new Set([finding.evidenceQuote!, ...(Array.isArray(alternatives) ? alternatives.map(String) : [])])] };
      }),
    },
    facts: {
      approved: approved.map((item) => item.text),
      keepExactly: inTargets("fact_verification").filter((finding) => !isProblem(finding.severity)).map((finding) => ({ moduleId: finding.scriptModuleId, sentence: finding.scriptQuote })),
      unsupported: problemsFor("fact_verification").map((finding) => ({ moduleId: finding.scriptModuleId, claim: finding.scriptQuote, problem: finding.message, closestApprovedRecord: finding.evidenceQuote })),
    },
    specificity: { genericLines: problemsFor("specificity").map((finding) => ({ moduleId: finding.scriptModuleId, line: finding.scriptQuote })) },
    structure: { expectedOrder: structure?.expectedCodes ?? [], missingBeats: missingBeats.map((entry) => ({ code: entry.code, label: entry.label, description: entry.description })) },
  };

  const originalLedger = beatLedger(scored.findings);
  const originalFacts = scored.findings.filter((finding) => finding.module === "fact_verification");
  const originalClaims = new Set(scored.findings.filter((finding) => finding.module === "fact_verification").map((finding) => finding.scriptQuote));
  const scoreEdit = async (kept: ScoreImprovementModule[]) => {
    const byId = new Map(kept.map((module) => [module.id, module]));
    const candidate = parseScriptDocument({ ...document, modules: document.modules.map((module) => (byId.has(module.id) ? { ...module, ...byId.get(module.id)! } : module)) });
    const rescored = await scoreDocument(context, candidate, input.runId);
    const findings = rescored.results.flatMap((result) => result.findings) as AnyFinding[];
    const after: Record<string, number | null> = Object.fromEntries(rescored.results.map((result) => [result.module, result.score]));
    // Unchanged sentences keep their original Facts verdict (see stabilizedFactScore).
    const facts = stabilizedFactScore(originalFacts, findings.filter((finding) => finding.module === "fact_verification"));
    if (facts != null && after.fact_verification != null) after.fact_verification = facts;
    return { candidate, after, findings, verdict: judgeScoreImprovement(before, after) };
  };

  let feedback: unknown = null;
  let last: ScoreImprovement = { accepted: false, before, after: null, modules: [], reasons: [], reverted: [], unverifiedClaims: unverifiedNow, attempts: 0 };
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= IMPROVE_MAX_ATTEMPTS; attempt += 1) {
    // An attempt takes 60-90s; never start one that could run past the route's 300s limit.
    if (attempt > 1 && Date.now() - startedAt > IMPROVE_TIME_BUDGET_MS) break;
    try {
      const text = await runAgent({
        role: "copywriter",
        additionalRoles: ["strategist"],
        instruction: IMPROVE_INSTRUCTION,
        context: JSON.stringify(feedback ? { ...brief, previousAttempt: feedback } : brief),
        json: true,
        responseJsonSchema: IMPROVE_RESPONSE_JSON_SCHEMA,
        feature: "script_score_improve",
        metadata: { promptVersion: SCRIPT_SCORE_IMPROVE_PROMPT_VERSION, runId: input.runId, attempt, retryReason: feedback ? JSON.stringify(feedback).slice(0, 300) : undefined },
        maxOutputTokens: 8192,
        thinkingBudget: 3072,
      });
      const returned = (extractJsonObject<{ modules?: ScoreImprovementModule[] }>(text).modules ?? []).filter((module) => targets.has(module.id));
      if (!returned.length) throw new Error("The edit returned none of the target modules.");

      // Free checks per beat. A beat that fails one is reverted, not the whole edit.
      const reverted = new Map<string, string>();
      let kept = returned.filter((edited, index) => returned.findIndex((other) => other.id === edited.id) === index).filter((edited) => {
        const original = document.modules.find((module) => module.id === edited.id)!;
        const bounds = allowedWords(spokenWords(original.spokenText));
        const words = spokenWords(edited.spokenText);
        const problem = !edited.spokenText.trim() || !edited.onScreenText.trim() || !edited.visualDirection.trim() ? "a field came back empty"
          : words < bounds.min || words > bounds.max ? `spokenText is ${words} words, allowed ${bounds.min}-${bounds.max}` : null;
        if (problem) reverted.set(edited.id, problem);
        return !problem;
      });
      const errorsIn = (doc: ScriptDocument) => inspectScriptQuality(doc).filter((issue) => issue.severity === "error").length;

      let result = kept.length ? await scoreEdit(kept) : null;
      if (result && errorsIn(result.candidate) > errorsIn(document)) throw new Error("The edit introduced a new script-quality error.");

      // Salvage, in ONE extra re-score: revert every beat that made a falling check
      // worse, lost a supported claim, or ADDED a claim no approved record backs.
      // Accuracy beats score, so an inventing beat is reverted even when Facts rose.
      const newUnsupported = (findings: AnyFinding[]) => findings.filter((finding) => finding.module === "fact_verification" && isProblem(finding.severity) && finding.scriptModuleId && targets.has(finding.scriptModuleId) && !originalClaims.has(finding.scriptQuote));
      if (result) {
        const falling = result.verdict.accept ? [] : Object.keys(before).filter((module) => before[module] != null && (result!.after[module] ?? -1) < before[module]!);
        const ledger = beatLedger(result.findings);
        const inventing = new Set(newUnsupported(result.findings).map((finding) => finding.scriptModuleId!));
        const offenders = kept.filter((edited) => inventing.has(edited.id)
          || falling.some((module) => (ledger.problems.get(`${edited.id}|${module}`) ?? 0) > (originalLedger.problems.get(`${edited.id}|${module}`) ?? 0))
          || (!result!.verdict.accept && (ledger.supported.get(edited.id) ?? 0) < (originalLedger.supported.get(edited.id) ?? 0)));
        if (offenders.length && offenders.length < kept.length) {
          for (const offender of offenders) reverted.set(offender.id, inventing.has(offender.id) ? "it added a claim no approved record supports" : "its edit lowered a score");
          kept = kept.filter((edited) => !offenders.includes(edited));
          result = await scoreEdit(kept);
        }
        if (newUnsupported(result.findings).some((finding) => kept.some((edited) => edited.id === finding.scriptModuleId))) {
          result = { ...result, verdict: { accept: false, gain: result.verdict.gain, reasons: ["the edit adds a claim no approved record supports"] } };
        }
      }
      const revertedLabels = [...reverted.keys()].map((id) => labelOf.get(id) ?? id);
      if (result?.verdict.accept) {
        return { accepted: true, before, after: result.after, modules: kept, reasons: [], reverted: revertedLabels, unverifiedClaims: unverified(result.findings), attempts: attempt };
      }
      const newBadClaims = newUnsupported(result?.findings ?? []).map((finding) => finding.scriptQuote);
      last = { accepted: false, before, after: result?.after ?? null, modules: [], reasons: result?.verdict.reasons ?? [...reverted.values()], reverted: revertedLabels, unverifiedClaims: unverifiedNow, attempts: attempt };
      feedback = {
        yourModules: returned,
        refusedBecause: result?.verdict.reasons ?? [],
        scoresAfterYourEdit: result?.after ?? null,
        revertedBeats: [...reverted].map(([id, why]) => ({ moduleId: id, why })),
        sentencesNowCountedAsUnsupportedClaims: newBadClaims,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      last = { ...last, reasons: [reason], attempts: attempt };
      feedback = { refusedBecause: [reason] };
    }
  }
  return last;
}
