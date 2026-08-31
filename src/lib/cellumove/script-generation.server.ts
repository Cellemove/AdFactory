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
  buildScriptGenerationContext,
  hardClaimFlags,
  SCRIPT_DRAFT_PROMPT_VERSION,
  SCRIPT_DRAFT_SYSTEM_INSTRUCTION,
  type ScriptGenerationBrollClip,
  type ScriptGenerationSourceRef,
} from "@/lib/cellumove/script-generation";
import type { ScriptDocument } from "@/lib/cellumove/script-studio";
import { createTeardownBrief } from "@/lib/cellumove/teardown-brief";
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
      for (const key of ["rootCause", "brandDna", "copyArsenal", "adScripts"]) {
        const value = parsed.stages[key];
        if (value == null) continue;
        stages[key] = truncate(JSON.stringify(value), key === "adScripts" ? 6000 : 4500) ?? "";
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

function sourceSnapshot<T>(rows: T[], limit = 30): T[] {
  return rows.slice(0, limit);
}

export async function generateResourceGroundedScript(input: {
  scaffold: ScriptDocument;
  idea: string;
  product: ProductRow;
  angle: AngleRow;
  avatar: SubAvatarRow | null;
  framework: ReferenceFormatRow | null;
  teardown: TeardownRecord | null;
  preserveLocked?: boolean;
}): Promise<ResourceGroundedScriptResult> {
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
    input.avatar
      ? optionalRows<ResearchRow>(
          "pipeline outputs",
          supabase.from("Research").select("*").eq("type", "pipeline").order("createdAt", { ascending: false }).limit(12),
        )
      : Promise.resolve([]),
  ]);

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
      research: avatarResearch ? {
        painPoints: truncate(avatarResearch.painPoints, 2500),
        desires: truncate(avatarResearch.desires, 2500),
        objections: truncate(avatarResearch.objections, 2200),
        dailyLanguage: truncate(avatarResearch.dailyLanguage, 2500),
        triggers: truncate(avatarResearch.triggers, 2200),
        identity: truncate(avatarResearch.identity, 1800),
        socialProof: truncate(avatarResearch.socialProof, 1800),
        buyingContext: truncate(avatarResearch.buyingContext, 1800),
      } : null,
      strategistProfile: truncate(renderStrategistProfile(profile), 5000),
      copywriterProfile: truncate(renderCopywriterProfile(profile), 6500),
      designerProfile: truncate(renderDesignerProfile(profile), 4500),
    } : null,
    framework: input.framework ? {
      name: input.framework.name,
      description: input.framework.description,
      beats: safeJson(input.framework.beats),
      bestForAngle: input.framework.bestForAngle,
      exampleScripts: (safeJson(input.framework.exampleScripts) as unknown[] | null)?.slice?.(0, 3) ?? [],
    } : null,
    teardown: teardownBrief,
    verbatims: verbatims.map((row) => ({
      id: row.id,
      category: row.category,
      text: truncate(row.text, 600),
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
    })),
    knowledge: knowledgeNotes.map((note) => ({
      id: note.id,
      title: note.title,
      body: truncate(note.body, 1800),
      tags: note.tags,
    })),
    copyPrinciples: copyPrinciples.map((principle) => ({ title: principle.title, body: principle.body })),
    winningAds: winningAds.map((ad) => ({
      id: ad.id,
      name: ad.adName,
      headline: truncate(ad.headline, 500),
      hookType: ad.hookType,
      visualConcept: truncate(ad.visualConcept, 1200),
      notes: truncate(ad.notes, 1000),
      metrics: truncate(ad.metrics, 500),
    })),
    latestPipeline: pipelineContext,
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
      snapshot: { avatar: resources.avatar },
    });
  }
  if (verbatims.length) {
    sources.push({
      sourceType: "research",
      sourceId: null,
      title: `Customer verbatims · ${verbatims.length} selected`,
      url: null,
      snapshot: sourceSnapshot(resources.verbatims),
    });
  }
  if (knowledgeNotes.length || copyPrinciples.length || winningAds.length || pipelineContext) {
    sources.push({
      sourceType: "research",
      sourceId: pipelineContext?.id ?? null,
      title: "AdFactory knowledge, principles, winners, and pipeline intelligence",
      url: null,
      snapshot: {
        knowledge: sourceSnapshot(resources.knowledge, 10),
        copyPrinciples: resources.copyPrinciples,
        winningAds: resources.winningAds,
        latestPipeline: pipelineContext,
      },
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
  };

  let correction: string | null = null;
  let lastError: unknown = null;
  let previousDraft: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await runAgent({
        role: "copywriter",
        additionalRoles: ["strategist", "designer"],
        instruction: SCRIPT_DRAFT_SYSTEM_INSTRUCTION,
        context: buildScriptGenerationContext({
          scaffold: input.scaffold,
          idea: input.idea,
          resources,
          allowedBrollClipIds: mappedBroll.map((clip) => clip.id),
          correction,
        }),
        json: true,
        feature: "script_studio_draft",
        metadata: { promptVersion: SCRIPT_DRAFT_PROMPT_VERSION, attempt, resourceCounts },
        maxOutputTokens: 16384,
        thinkingBudget: 3072,
      });
      const draft = extractJsonObject<unknown>(text);
      previousDraft = draft;
      const baseRefs = sources.map(sourceRef);
      const document = applyGeneratedScriptDraft({
        scaffold: input.scaffold,
        draft,
        brollClips: mappedBroll,
        sourceRefs: baseRefs,
        preserveLocked: input.preserveLocked,
      });
      const hardClaims = hardClaimFlags(document);
      if (hardClaims.length) {
        throw new Error(`Remove unsupported claims: ${hardClaims.join("; ")}`);
      }

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
      const reason = truncate(error instanceof Error ? error.message : String(error), 1200);
      const rejected = previousDraft ? truncate(JSON.stringify(previousDraft), 8000) : null;
      correction = [
        `The previous JSON was rejected: ${reason}`,
        "Rewrite the complete JSON and correct every reported issue. Never repeat a forbidden word, even in a negated phrase.",
        rejected ? `Rejected JSON to correct: ${rejected}` : "",
      ].filter(Boolean).join("\n");
    }
  }

  throw new Error(`AI could not produce a valid complete script draft after three attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
