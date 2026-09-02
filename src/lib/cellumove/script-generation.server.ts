import "server-only";

import {
  extractJsonObject,
  runAgent,
} from "@/lib/cellumove/agents";
import {
  parseAvatarProfile,
  renderCopywriterProfile,
  renderDesignerProfile,
  renderStrategistProfile,
} from "@/lib/cellumove/avatar-profile";
import {
  applyGeneratedScriptDraft,
  buildScriptCorrectionContext,
  buildScriptGenerationContext,
  mergeScriptDraftCorrection,
  planScriptDraftCorrection,
  SCRIPT_DRAFT_CORRECTION_INSTRUCTION,
  hardClaimFlags,
  SCRIPT_DRAFT_PROMPT_VERSION,
  SCRIPT_DRAFT_SYSTEM_INSTRUCTION,
  type ScriptGenerationBrollClip,
  type ScriptGenerationSourceRef,
} from "@/lib/cellumove/script-generation";
import { SCRIPT_RAG_VERSION, type ScriptRagCandidate } from "@/lib/cellumove/script-rag";
import { retrieveScriptModuleEvidence } from "@/lib/cellumove/script-rag.server";
import { reportScriptGenerationProgress, type ScriptGenerationProgressSink } from "@/lib/cellumove/script-generation-progress";
import { ensureScriptDurationPlan, type ScriptDocument } from "@/lib/cellumove/script-studio";
import { createTeardownBrief } from "@/lib/cellumove/teardown-brief";
import { PIPELINE_STAGES } from "@/lib/cellumove/pipeline-stages";
import type {
  AngleRow,
  AvatarResearchRow,
  BrollClipRow,
  CopyPrincipleRow,
  KnowledgeNoteRow,
  ProductRow,
  ReferenceFormatRow,
  ResearchRow,
  SubAvatarRow,
  VerbatimRow,
  WinningAdRow,
} from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { DEFAULT_MODEL } from "@/lib/llm";
import { readShopifyProductMetadata } from "@/lib/shopify";
import type { TeardownRecord } from "@/lib/teardown";

type SourceType = "teardown" | "broll" | "research" | "manual";

export interface GeneratedScriptSource {
  sourceType: SourceType;
  sourceId: string | null;
  title: string;
  url: string | null;
  snapshot: unknown;
}

export interface ResourceGroundedScriptResult {
  document: ScriptDocument;
  sources: GeneratedScriptSource[];
  model: string;
  promptVersion: string;
  resourceCounts: Record<string, number>;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

async function optionalRows<T>(
  label: string,
  query: PromiseLike<QueryResult<T[]>>,
): Promise<T[]> {
  try {
    const result = await query;
    if (result.error) {
      console.warn(`Script generation skipped ${label}: ${result.error.message}`);
      return [];
    }
    return result.data ?? [];
  } catch (error) {
    console.warn(`Script generation skipped ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function optionalOne<T>(
  label: string,
  query: PromiseLike<QueryResult<T>>,
): Promise<T | null> {
  try {
    const result = await query;
    if (result.error) {
      console.warn(`Script generation skipped ${label}: ${result.error.message}`);
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn(`Script generation skipped ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function safeJson(value: string | null | undefined): unknown {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return truncate(value, 4000);
  }
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function latestPipelineContext(rows: ResearchRow[], avatarId: string | null): {
  id: string;
  createdAt: string;
  stages: Record<string, string>;
} | null {
  if (!avatarId) return null;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.drafts) as {
        subAvatarId?: unknown;
        stages?: Record<string, unknown>;
      };
      if (parsed.subAvatarId !== avatarId || !parsed.stages) continue;
      const stages: Record<string, string> = {};
      for (const { key } of PIPELINE_STAGES) {
        const value = parsed.stages[key];
        if (value == null) continue;
        stages[key] = truncate(JSON.stringify(value), key === "deepDive" || key === "adScripts" ? 6000 : 4500) ?? "";
      }
      return Object.keys(stages).length ? { id: row.id, createdAt: row.createdAt, stages } : null;
    } catch {
      continue;
    }
  }
  return null;
}

function sourceRef(source: GeneratedScriptSource): ScriptGenerationSourceRef {
  return {
    type: source.sourceType,
    id: source.sourceId,
    title: source.title,
    url: source.url,
  };
}

function scriptRagCandidates(input: {
  product: ProductRow;
  shopify: ReturnType<typeof readShopifyProductMetadata>;
  avatarResearch: AvatarResearchRow | null;
  strategistProfile: string;
  copywriterProfile: string;
  designerProfile: string;
  verbatims: VerbatimRow[];
  knowledgeNotes: KnowledgeNoteRow[];
  copyPrinciples: CopyPrincipleRow[];
  winningAds: WinningAdRow[];
  pipelineContext: ReturnType<typeof latestPipelineContext>;
  teardownBrief: ReturnType<typeof createTeardownBrief> | null;
  teardownUrl: string | null;
}): ScriptRagCandidate[] {
  const candidates: ScriptRagCandidate[] = [];
  const add = (candidate: ScriptRagCandidate) => {
    const text = truncate(candidate.text, 1800);
    if (text) candidates.push({ ...candidate, text });
  };

  add({
    id: `product:${input.product.id}`,
    source: "product",
    category: "product features mechanism offer options",
    title: `${input.product.name} product facts`,
    text: [
      input.product.description,
      input.shopify ? JSON.stringify({
        vendor: input.shopify.vendor,
        productType: input.shopify.productType,
        options: input.shopify.options,
        variants: input.shopify.variants.slice(0, 20).map((variant) => ({
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          selectedOptions: variant.selectedOptions,
        })),
      }) : "",
    ].filter(Boolean).join("\n"),
    url: input.shopify?.onlineStoreUrl ?? null,
    verified: true,
  });

  if (input.avatarResearch) {
    const avatarFields: Array<[string, string, string]> = [
      ["pain_points", "pain problem frustration", input.avatarResearch.painPoints],
      ["desires", "desire dream outcome hook", input.avatarResearch.desires],
      ["objections", "objection problem offer", input.avatarResearch.objections],
      ["daily_language", "customer language hook problem", input.avatarResearch.dailyLanguage],
      ["triggers", "trigger hook buying context", input.avatarResearch.triggers],
      ["identity", "identity avatar emotion", input.avatarResearch.identity],
      ["social_proof", "social proof result evidence", input.avatarResearch.socialProof],
      ["buying_context", "buying context offer cta", input.avatarResearch.buyingContext],
      ["strategist_profile", "creative strategy avatar", input.strategistProfile],
      ["copywriter_profile", "customer language copy avatar", input.copywriterProfile],
      ["designer_profile", "visual direction avatar", input.designerProfile],
    ];
    avatarFields.forEach(([key, category, text]) => add({
      id: `avatar:${input.avatarResearch!.id}:${key}`,
      source: "avatar",
      category,
      title: `Avatar research · ${key.replaceAll("_", " ")}`,
      text,
      url: null,
      verified: true,
    }));
  }

  input.verbatims.forEach((row) => add({
    id: `verbatim:${row.id}`,
    source: "verbatim",
    category: row.category,
    title: `Verified customer verbatim · ${row.category}`,
    text: row.text,
    url: row.sourceUrl,
    verified: row.researchId?.startsWith("verified:") ?? false,
  }));
  input.knowledgeNotes.forEach((note) => add({
    id: `knowledge:${note.id}`,
    source: "knowledge",
    category: `knowledge ${note.tags ?? ""}`,
    title: note.title,
    text: note.body,
    url: null,
    verified: true,
  }));
  input.copyPrinciples.forEach((principle) => add({
    id: `principle:${principle.id}`,
    source: "principle",
    category: `${principle.category} copy principle`,
    title: principle.title,
    text: principle.body,
    url: null,
    verified: true,
  }));
  input.winningAds.forEach((ad) => add({
    id: `winning_ad:${ad.id}`,
    source: "winning_ad",
    category: `winning ad ${ad.hookType ?? ""}`,
    title: ad.adName,
    text: [ad.headline, ad.visualConcept, ad.notes, ad.metrics].filter(Boolean).join("\n"),
    url: null,
    verified: true,
  }));
  if (input.pipelineContext) {
    Object.entries(input.pipelineContext.stages).forEach(([stage, text]) => add({
      id: `pipeline:${input.pipelineContext!.id}:${stage}`,
      source: "pipeline",
      category: `pipeline ${stage}`,
      title: `Prior pipeline · ${stage}`,
      text,
      url: null,
      verified: true,
    }));
  }
  if (input.teardownBrief) {
    Object.entries(input.teardownBrief).forEach(([category, insights]) => {
      if (category === "schemaVersion" || !Array.isArray(insights)) return;
      insights.forEach((insight, index) => add({
        id: `teardown:${category}:${index + 1}`,
        source: "teardown",
        category: `teardown ${category}`,
        title: `Teardown ${category} · ${insight.label}`,
        text: insight.value,
        url: input.teardownUrl,
        verified: true,
      }));
    });
  }
  return candidates;
}

export async function generateResourceGroundedScript(input: {
  scaffold: ScriptDocument;
  idea: string;
  product: ProductRow;
  angle: AngleRow;
  avatar: SubAvatarRow | null;
  framework: ReferenceFormatRow | null;
  teardown: TeardownRecord | null;
  pipelineRunId?: string | null;
  onProgress?: ScriptGenerationProgressSink;
  preserveLocked?: boolean;
}): Promise<ResourceGroundedScriptResult> {
  const scaffold = ensureScriptDurationPlan(input.scaffold);
  if (scaffold.modules.length > input.scaffold.modules.length) {
    await reportScriptGenerationProgress(input.onProgress, {
      stage: "setup",
      level: "success",
      message: `Expanded the framework to ${scaffold.modules.length} production beats`,
      detail: `${input.scaffold.modules.length} original beats were not enough for the ${scaffold.targetDurationSec}s target; ${scaffold.modules.length - input.scaffold.modules.length} detailed beats were added before the CTA.`,
    });
  }
  await reportScriptGenerationProgress(input.onProgress, {
    stage: "resources",
    level: "info",
    message: "Loading avatar research, verified verbatims, knowledge, winning ads, pipeline intelligence, and B-roll",
  });
  const [
    avatarResearch,
    avatarVerbatims,
    angleVerbatims,
    knowledgeNotes,
    copyPrinciples,
    brollClips,
    winningAds,
    pipelineRows,
  ] = await Promise.all([
    input.avatar
      ? optionalOne<AvatarResearchRow>(
          "avatar research",
          supabase.from("AvatarResearch").select("*").eq("subAvatarId", input.avatar.id).maybeSingle(),
        )
      : Promise.resolve(null),
    input.avatar
      ? optionalRows<VerbatimRow>(
          "avatar verbatims",
          supabase
            .from("Verbatim")
            .select("*")
            .eq("subAvatarId", input.avatar.id)
            .like("researchId", "verified:%")
            .order("sourceWeight", { ascending: false })
            .order("engagementScore", { ascending: false })
            .limit(24),
        )
      : Promise.resolve([]),
    optionalRows<VerbatimRow>(
      "angle verbatims",
      supabase
        .from("Verbatim")
        .select("*")
        .eq("angleSlug", input.angle.slug)
        .like("researchId", "verified:%")
        .order("sourceWeight", { ascending: false })
        .order("engagementScore", { ascending: false })
        .limit(24),
    ),
    optionalRows<KnowledgeNoteRow>(
      "knowledge notes",
      supabase
        .from("KnowledgeNote")
        .select("*")
        .order("pinned", { ascending: false })
        .order("updatedAt", { ascending: false })
        .limit(10),
    ),
    optionalRows<CopyPrincipleRow>(
      "copy principles",
      supabase.from("CopyPrinciple").select("*").eq("category", "writing").order("order").limit(20),
    ),
    optionalRows<BrollClipRow>(
      "B-roll library",
      supabase
        .from("BrollClip")
        .select("*")
        .order("timesSuggested", { ascending: true })
        .order("indexedAt", { ascending: false })
        .limit(40),
    ),
    optionalRows<WinningAdRow>(
      "winning ads",
      supabase.from("WinningAd").select("*").eq("angleId", input.angle.id).order("createdAt", { ascending: false }).limit(8),
    ),
    input.avatar && input.pipelineRunId
      ? optionalRows<ResearchRow>(
          "selected pipeline output",
          supabase.from("Research").select("*").eq("id", input.pipelineRunId).eq("type", "pipeline").limit(1),
        )
      : input.avatar
      ? optionalRows<ResearchRow>(
          "pipeline outputs",
          supabase.from("Research").select("*").eq("type", "pipeline").order("createdAt", { ascending: false }).limit(12),
        )
      : Promise.resolve([]),
  ]);

  await reportScriptGenerationProgress(input.onProgress, {
    stage: "resources",
    level: "success",
    message: "Resource stores loaded",
    detail: `${avatarResearch ? 1 : 0} avatar profile · ${avatarVerbatims.length + angleVerbatims.length} verified verbatim matches · ${knowledgeNotes.length} knowledge notes · ${copyPrinciples.length} copy principles · ${winningAds.length} winning ads · ${brollClips.length} B-roll clips`,
  });

  const verbatims = uniqueById([...avatarVerbatims, ...angleVerbatims]).slice(0, 36);
  const profile = parseAvatarProfile(avatarResearch?.profile);
  const pipelineContext = latestPipelineContext(pipelineRows, input.avatar?.id ?? null);
  const shopify = readShopifyProductMetadata(input.product.context);
  const teardownBrief = input.teardown ? createTeardownBrief(input.teardown.parsed_output) : null;

  const brollResources = brollClips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    folderPath: clip.folderPath,
    description: truncate(clip.aiDescription || clip.description, 500),
    tags: truncate(clip.tags, 300),
    timesSuggested: clip.timesSuggested,
  }));
  const mappedBroll: ScriptGenerationBrollClip[] = brollClips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    url: clip.webViewLink,
  }));

  const strategistProfile = renderStrategistProfile(profile);
  const copywriterProfile = renderCopywriterProfile(profile);
  const designerProfile = renderDesignerProfile(profile);
  const ragCandidates = scriptRagCandidates({
    product: input.product,
    shopify,
    avatarResearch,
    strategistProfile,
    copywriterProfile,
    designerProfile,
    verbatims,
    knowledgeNotes,
    copyPrinciples,
    winningAds,
    pipelineContext,
    teardownBrief,
    teardownUrl: input.teardown?.source_url ?? null,
  });
  await reportScriptGenerationProgress(input.onProgress, {
    stage: "retrieval",
    level: "info",
    message: "Running per-module Script Maker RAG",
    detail: `${ragCandidates.length} evidence candidates across ${scaffold.modules.filter((module) => !module.locked).length} editable modules`,
  });
  const moduleRetrieval = await retrieveScriptModuleEvidence({
    scaffold,
    idea: input.idea,
    candidates: ragCandidates,
    topK: 6,
  });
  const moduleEvidence = moduleRetrieval.packs.map((pack) => ({
    moduleId: pack.moduleId,
    moduleLabel: pack.moduleLabel,
    moduleKind: pack.moduleKind,
    items: pack.items.map((item) => ({
      id: item.id,
      source: item.source,
      category: item.category,
      title: item.title,
      text: item.text,
      url: item.url,
      verified: item.verified,
      retrievalScore: item.score,
    })),
  }));
  await reportScriptGenerationProgress(input.onProgress, {
    stage: "retrieval",
    level: moduleRetrieval.mode === "hybrid" ? "success" : "warning",
    message: moduleRetrieval.mode === "hybrid" ? "Hybrid semantic and keyword retrieval completed" : "Embedding service unavailable; keyword retrieval fallback completed",
    detail: `${moduleRetrieval.packs.reduce((sum, pack) => sum + pack.items.length, 0)} evidence selections`,
  });
  for (const pack of moduleRetrieval.packs) {
    await reportScriptGenerationProgress(input.onProgress, {
      stage: "retrieval",
      level: "info",
      message: `${pack.moduleLabel}: ${pack.items.length} evidence items selected`,
      detail: [...new Set(pack.items.map((item) => item.source))].join(", ") || "No matching evidence",
    });
  }

  const resources = {
    product: {
      id: input.product.id,
      name: input.product.name,
      code: input.product.code,
      description: truncate(input.product.description, 5000),
      image: input.product.imagePath,
      shopify: shopify ? {
        vendor: shopify.vendor,
        productType: shopify.productType,
        options: shopify.options.slice(0, 12),
        variants: shopify.variants.slice(0, 20).map((variant) => ({
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          selectedOptions: variant.selectedOptions,
        })),
        images: (shopify.images ?? []).slice(0, 16).map((image) => ({ url: image.url, altText: image.altText })),
      } : null,
    },
    angle: {
      name: input.angle.name,
      slug: input.angle.slug,
      requiredKeyword: input.angle.requiredKeyword,
      mechanism: input.angle.mechanism,
      bannedMechanism: input.angle.bannedMechanism,
      silhouette: input.angle.silhouette,
      colorway: input.angle.colorway,
    },
    avatar: input.avatar ? {
      name: input.avatar.name,
      description: input.avatar.shortDesc,
      researchAvailable: Boolean(avatarResearch),
    } : null,
    framework: input.framework ? {
      name: input.framework.name,
      description: input.framework.description,
      beats: safeJson(input.framework.beats),
      bestForAngle: input.framework.bestForAngle,
      exampleScripts: (safeJson(input.framework.exampleScripts) as unknown[] | null)?.slice?.(0, 3) ?? [],
    } : null,
    moduleEvidence: {
      version: SCRIPT_RAG_VERSION,
      retrievalMode: moduleRetrieval.mode,
      packs: moduleEvidence,
    },
    broll: brollResources,
  };

  const sources: GeneratedScriptSource[] = [{
    sourceType: "manual",
    sourceId: input.product.id,
    title: `${input.product.name} · ${input.angle.name} · selected creative brief`,
    url: shopify?.onlineStoreUrl ?? null,
    snapshot: { product: resources.product, angle: resources.angle, framework: resources.framework, idea: input.idea },
  }];
  if (avatarResearch && input.avatar) {
    sources.push({
      sourceType: "research",
      sourceId: avatarResearch.id,
      title: `Avatar research · ${input.avatar.name}`,
      url: null,
      snapshot: { avatar: resources.avatar, researchId: avatarResearch.id },
    });
  }
  const selectedEvidenceCount = moduleEvidence.reduce((sum, pack) => sum + pack.items.length, 0);
  if (selectedEvidenceCount) {
    sources.push({
      sourceType: "research",
      sourceId: null,
      title: `Script Maker RAG · ${selectedEvidenceCount} module evidence selections`,
      url: null,
      snapshot: {
        version: SCRIPT_RAG_VERSION,
        retrievalMode: moduleRetrieval.mode,
        candidateCount: ragCandidates.length,
        packs: moduleRetrieval.packs,
      },
    });
  }
  if (pipelineContext) {
    sources.push({
      sourceType: "research",
      sourceId: pipelineContext.id,
      title: `Pipeline run · ${pipelineContext.id}`,
      url: null,
      snapshot: pipelineContext,
    });
  }
  if (input.teardown) {
    sources.push({
      sourceType: "teardown",
      sourceId: input.teardown.id,
      title: input.teardown.ad_name || input.teardown.original_filename,
      url: input.teardown.source_url ?? null,
      snapshot: input.teardown,
    });
  }

  const resourceCounts = {
    avatarResearch: avatarResearch ? 1 : 0,
    verbatims: verbatims.length,
    knowledgeNotes: knowledgeNotes.length,
    copyPrinciples: copyPrinciples.length,
    winningAds: winningAds.length,
    pipelineStages: pipelineContext ? Object.keys(pipelineContext.stages).length : 0,
    teardownInsights: teardownBrief
      ? Object.values(teardownBrief).filter(Array.isArray).reduce((sum, value) => sum + value.length, 0)
      : 0,
    brollClips: brollClips.length,
    ragCandidates: ragCandidates.length,
    ragModules: moduleEvidence.length,
    ragEvidenceItems: selectedEvidenceCount,
    ragHybridMode: moduleRetrieval.mode === "hybrid" ? 1 : 0,
  };

  let lastError: unknown = null;
  let previousDraft: unknown = null;
  let correctionPlan: ReturnType<typeof planScriptDraftCorrection> | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await reportScriptGenerationProgress(input.onProgress, {
        stage: "model",
        level: "info",
        message: `Generating complete structured draft · attempt ${attempt}/3`,
        detail: `${scaffold.modules.length} modules · ${scaffold.targetDurationSec}s target · ${DEFAULT_MODEL}`,
      });
      const isTargetedCorrection = Boolean(correctionPlan && previousDraft);
      const text = await runAgent({
        role: "copywriter",
        additionalRoles: ["strategist", "designer"],
        instruction: isTargetedCorrection ? SCRIPT_DRAFT_CORRECTION_INSTRUCTION : SCRIPT_DRAFT_SYSTEM_INSTRUCTION,
        promptSopSlug: isTargetedCorrection ? undefined : "creative-strategist-script-maker",
        context: isTargetedCorrection
          ? buildScriptCorrectionContext({ scaffold, idea: input.idea, resources, allowedBrollClipIds: mappedBroll.map((clip) => clip.id), plan: correctionPlan! })
          : buildScriptGenerationContext({ scaffold, idea: input.idea, resources, allowedBrollClipIds: mappedBroll.map((clip) => clip.id) }),
        json: true,
        feature: "script_studio_draft",
        metadata: { promptVersion: SCRIPT_DRAFT_PROMPT_VERSION, attempt, resourceCounts, correctionModuleIds: correctionPlan?.moduleIds },
        maxOutputTokens: 16384,
        thinkingBudget: 3072,
      });
      const raw = extractJsonObject<unknown>(text);
      const draft = isTargetedCorrection ? mergeScriptDraftCorrection(previousDraft, raw, correctionPlan!) : raw;
      await reportScriptGenerationProgress(input.onProgress, {
        stage: "model",
        level: "success",
        message: `Model response received · attempt ${attempt}/3`,
      });
      previousDraft = draft;
      correctionPlan = null;
      const baseRefs = sources.map(sourceRef);
      const document = applyGeneratedScriptDraft({
        scaffold,
        draft,
        brollClips: mappedBroll,
        sourceRefs: baseRefs,
        preserveLocked: input.preserveLocked,
      });
      const hardClaims = hardClaimFlags(document);
      if (hardClaims.length) {
        throw new Error(`Remove unsupported claims: ${hardClaims.join("; ")}`);
      }

      const timingExpansions = document.modules.filter((module) => module.claimFlags.some((flag) => flag.startsWith("timing:")));
      await reportScriptGenerationProgress(input.onProgress, {
        stage: "validation",
        level: timingExpansions.length ? "warning" : "success",
        message: "Structured draft passed validation",
        detail: timingExpansions.length
          ? `${timingExpansions.length} module timing${timingExpansions.length === 1 ? " was" : "s were"} expanded to preserve complete spoken copy`
          : "Module coverage, claims, B-roll IDs, and timings are valid",
      });

      const usedBrollIds = new Set(document.modules.flatMap((module) => module.brollRefs.map((ref) => ref.clipId)).filter(Boolean));
      for (const clip of brollClips) {
        if (!usedBrollIds.has(clip.id)) continue;
        const brollSource: GeneratedScriptSource = {
          sourceType: "broll",
          sourceId: clip.id,
          title: clip.name,
          url: clip.webViewLink,
          snapshot: clip,
        };
        sources.push(brollSource);
        document.sourceRefs.push(sourceRef(brollSource));
      }
      return {
        document,
        sources,
        model: DEFAULT_MODEL,
        promptVersion: SCRIPT_DRAFT_PROMPT_VERSION,
        resourceCounts,
      };
    } catch (error) {
      lastError = error;
      const reason = truncate(error instanceof Error ? error.message : String(error), 1200) ?? "Unknown validation error";
      correctionPlan = previousDraft
        ? planScriptDraftCorrection({ scaffold, draft: previousDraft, allowedBrollClipIds: mappedBroll.map((clip) => clip.id), reason })
        : null;
      await reportScriptGenerationProgress(input.onProgress, {
        stage: "validation",
        level: attempt < 3 ? "warning" : "error",
        message: attempt < 3
          ? correctionPlan
            ? `Draft rejected; regenerating only ${correctionPlan.moduleIds.length} rejected module${correctionPlan.moduleIds.length === 1 ? "" : "s"}`
            : `Draft rejected; preparing correction attempt ${attempt + 1}/3`
          : "Draft rejected after the final attempt",
        detail: correctionPlan ? `${reason} · IDs: ${correctionPlan.moduleIds.join(", ") || "5D/hooks only"}` : reason,
      });
    }
  }

  throw new Error(`AI could not produce a valid complete script draft after three attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
