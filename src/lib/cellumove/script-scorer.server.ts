import "server-only";

import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { embedTexts } from "@/lib/cellumove/embeddings";
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
  scoreVerbatimGrounding,
  scorerInputHash,
  type AnalyzedScript,
  type ApprovedEvidence,
  type GoldAdInput,
  type GroundingMatch,
  type ScriptScorerModuleResult,
} from "@/lib/cellumove/script-scorer";
import { parseScriptDocument, type ScriptDocument } from "@/lib/cellumove/script-studio";
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

type VerbatimCohort = {
  count: number;
  name: "avatar_market" | "avatar_all_markets" | "angle_market" | null;
  subAvatarId: string | null;
  angleSlug: string | null;
  market: string | null;
};

async function countVerbatims(filters: { subAvatarId?: string; angleSlug?: string; market?: string }): Promise<number> {
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

async function selectVerbatimCohort(context: ScoreContext): Promise<VerbatimCohort> {
  if (context.project.subAvatarId) {
    const avatarMarket = await countVerbatims({ subAvatarId: context.project.subAvatarId, market: context.marketCode });
    if (avatarMarket >= 10) return { count: avatarMarket, name: "avatar_market", subAvatarId: context.project.subAvatarId, angleSlug: null, market: context.marketCode };
    const avatarAll = await countVerbatims({ subAvatarId: context.project.subAvatarId });
    if (avatarAll >= 10) return { count: avatarAll, name: "avatar_all_markets", subAvatarId: context.project.subAvatarId, angleSlug: null, market: null };
  }
  const angleMarket = await countVerbatims({ angleSlug: context.angle.slug, market: context.marketCode });
  return { count: angleMarket, name: angleMarket >= 10 ? "angle_market" : null, subAvatarId: null, angleSlug: context.angle.slug, market: context.marketCode };
}

async function runGrounding(context: ScoreContext, analysis: AnalyzedScript): Promise<ScriptScorerModuleResult> {
  let cohort: VerbatimCohort;
  try {
    cohort = await selectVerbatimCohort(context);
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
  const matched = await Promise.all(eligible.map(async (line, index): Promise<GroundingMatch> => {
    const response = await supabase.rpc("match_verbatims", {
      query_embedding: `[${embeddings[index]!.join(",")}]`,
      match_count: 1,
      filter_sub_avatar_id: cohort.subAvatarId,
      filter_angle_slug: cohort.angleSlug,
      filter_market: cohort.market,
    });
    if (response.error) throw new Error(response.error.message);
    const best = response.data?.[0];
    return { line, evidenceId: best?.id ?? null, evidenceQuote: best?.text ?? null, similarity: best?.similarity ?? null };
  }));
  return scoreVerbatimGrounding({ matches: matched, candidateCount: cohort.count, cohort: cohort.name });
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
    const taxonomyResult = await supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION).order("code");
    if (taxonomyResult.error) throw new Error(taxonomyResult.error.message);
    const taxonomy = (taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[];
    const analysis = await extractAnalyzedScript({ document: context.document, taxonomy, runId, marketCode: context.marketCode });
    const [goldAds, grounding, approvedEvidence] = await Promise.all([
      loadGoldAds(context.angle.slug),
      runGrounding(context, analysis),
      loadApprovedEvidence(context),
    ]);
    const results = [
      scoreStructuralFit({ document: context.document, analysis, goldAds, angleSlug: context.angle.slug, format: context.document.format }),
      grounding,
      scoreSpecificity(analysis),
      scoreFactVerification({ analysis, evidence: approvedEvidence }),
      scoreObserverFlags({ document: context.document, analysis }),
    ];
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
