"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Type, type Part } from "@google/genai";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL, FAST_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { requireStrategist } from "@/lib/authorization";
import { readStoredImage, saveImage, storedImageExists } from "@/lib/storage";
import { finalizeAdImage } from "@/lib/image-compress";
import { applyCellumoveLogo, imageAdBrandingPrompt, loadCellumoveLogos } from "@/lib/cellumove/image-ad-branding";
import { probeImage } from "@/lib/image-probe";
import { extractJsonObject } from "@/lib/cellumove/agents";
import { scanClaims } from "@/lib/cellumove/claim-check";
import { ALLOWED_CTAS, BANNED_WORDS } from "@/lib/cellumove/constants";
import {
  IMAGE_AD_BATCH_TYPE,
  imageAdExportSize,
  imageAdModelProfile,
  normalizeFormat,
  normalizeTargetCount,
  parseImageAdBatchDoc,
  type ActionResult,
  type ImageAdBatchDoc,
} from "@/lib/cellumove/image-ad-batch";
import {
  planDirectionSizes,
  planSourceMix,
  type ImageAdCandidate,
  type ImageAdConcept,
} from "@/lib/cellumove/image-ad-concepts";
import {
  IMAGE_AD_REFERENCE_ROLES,
  imageAdReferenceSelectionError,
  imageAdReferencesReady,
  referenceImageQualityError,
  referenceNeedsRearchive,
  type ImageAdReferenceRole,
  type ImageAdReferenceSelection,
  type ImageAdReferenceSnapshot,
} from "@/lib/cellumove/image-ad-references";
import type {
  AngleRow,
  AvatarResearchRow,
  CompetitorAdRow,
  ProductRow,
  ResearchRow,
  SubAvatarRow,
} from "@/lib/database.types";

// ─── Provider resilience ──────────────────────────────────────────────────────

// Status codes only count inside a provider payload ("code":429 / status: 503) —
// a bare number would also match our own "500×300" dimension messages.
const RATE_LIMITED = /"code"\s*:\s*429|status:?\s*429|RESOURCE_EXHAUSTED/i;
const PROVIDER_DOWN = /"code"\s*:\s*50[0234]|status:?\s*50[0234]|\bUNAVAILABLE\b|DEADLINE_EXCEEDED|model is overloaded/i;
const NETWORK_DROPPED = /fetch failed|ECONNRESET|ETIMEDOUT/i;
const isTransient = (message: string) => RATE_LIMITED.test(message) || PROVIDER_DOWN.test(message) || NETWORK_DROPPED.test(message);

// Rate limits and brief outages are routine on a shared model endpoint. Retry a
// few times with backoff before bothering the strategist about it.
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  const delays = [4000, 12000, 30000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (attempt >= delays.length || !isTransient(message)) throw reason;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

// The SDK surfaces provider failures as raw JSON. Say what happened and what to
// do instead; anything we do not recognize passes through unchanged.
function friendlyError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (RATE_LIMITED.test(message)) {
    return "The AI service is rate-limiting us right now. Wait a minute and try again — everything finished so far is saved.";
  }
  if (PROVIDER_DOWN.test(message)) {
    return "The AI service is temporarily unavailable. Try again in a moment — everything finished so far is saved.";
  }
  if (NETWORK_DROPPED.test(message)) {
    return "Lost the connection to the AI service. Check your network and try again.";
  }
  if (/PERMISSION_DENIED|"code"\s*:\s*403/i.test(message)) {
    return "This Google Cloud project is not allowed to call that model. Check that the model is enabled for the project.";
  }
  if (/\bSAFETY\b|PROHIBITED_CONTENT|IMAGE_SAFETY/.test(message)) {
    return "The image model declined this concept on safety grounds. Re-plan or skip this one.";
  }
  return message;
}

async function loadBatchDoc(batchId: string): Promise<ImageAdBatchDoc> {
  if (!batchId) throw new Error("Image ad batch not found.");
  const row = unwrapOpt(
    await supabase.from("Research").select("*").eq("id", batchId).eq("type", IMAGE_AD_BATCH_TYPE).maybeSingle(),
  ) as ResearchRow | null;
  if (!row) throw new Error("Image ad batch not found.");
  return parseImageAdBatchDoc(row.drafts);
}

async function createImageAdBatchImpl(input: {
  subAvatarId: string;
  productId?: string | null;
  label?: string;
  targetCount?: number;
  format?: string;
}): Promise<{ batchId: string }> {
  if (!input.subAvatarId) throw new Error("Pick an avatar for this batch.");

  const sub = unwrapOpt(
    await supabase.from("SubAvatar").select("*").eq("id", input.subAvatarId).maybeSingle(),
  ) as SubAvatarRow | null;
  if (!sub) throw new Error("Avatar not found.");
  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("id", sub.angleId).maybeSingle(),
  ) as AngleRow | null;
  if (!angle) throw new Error("Angle for this avatar not found.");

  if (input.productId) {
    const product = unwrapOpt(
      await supabase.from("Product").select("id").eq("id", input.productId).maybeSingle(),
    ) as { id: string } | null;
    if (!product) throw new Error("Product not found.");
  }

  const id = newId();
  const doc: ImageAdBatchDoc = {
    subAvatarId: sub.id,
    angleSlug: angle.slug,
    productId: input.productId || null,
    label: (input.label ?? "").trim().slice(0, 120),
    targetCount: normalizeTargetCount(input.targetCount),
    format: normalizeFormat(input.format),
    references: [],
    candidates: [],
  };
  const res = await supabase.from("Research").insert({
    id,
    type: IMAGE_AD_BATCH_TYPE,
    angleSlug: angle.slug,
    focus: sub.name,
    drafts: JSON.stringify(doc),
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/image-ads");
  return { batchId: id };
}

// ─── Reference gate ───────────────────────────────────────────────────────────

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
// Only formats we can verify by parsing. An image we cannot decode is an image we
// cannot vouch for, and a reference we cannot vouch for poisons every concept
// built from it.
const REFERENCE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface FetchedImage {
  bytes: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

// Download, prove it decodes, and enforce the quality floor. `brandName` is only
// used to make the rejection message actionable.
async function fetchReferenceImage(url: string, brandName: string): Promise<FetchedImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("A selected BrandSearch reference has an invalid image URL. Refresh the winner pool and try again.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Reference images must use an http(s) URL.");

  const response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Could not archive the ${brandName} reference image (${response.status}). Refresh BrandSearch and try again.`);
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!REFERENCE_IMAGE_MIMES.has(contentType)) {
    throw new Error(`The ${brandName} reference is a ${contentType || "unknown"} file. References must be JPEG, PNG, or WebP — pick another.`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > MAX_REFERENCE_IMAGE_BYTES) throw new Error(`The ${brandName} reference image is larger than 10MB.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error(`The ${brandName} reference image is larger than 10MB.`);

  const probe = probeImage(bytes);
  if (!probe) {
    throw new Error(`The ${brandName} reference did not decode as a real image — BrandSearch may have served an error page. Refresh and pick another.`);
  }
  const qualityError = referenceImageQualityError(
    { width: probe.width, height: probe.height, byteSize: bytes.byteLength },
    brandName,
  );
  if (qualityError) throw new Error(qualityError);

  const extension = probe.format === "jpeg" ? "jpg" : probe.format;
  return { bytes, contentType, extension, width: probe.width, height: probe.height };
}

// Role-scoped analysis: the model describes only what the strategist asked this
// reference to inspire, and is told not to hand back copyable brand detail.
async function analyzeReferenceImage(
  ad: CompetitorAdRow,
  roles: ImageAdReferenceRole[],
  image: { bytes: Buffer; contentType: string },
  batchId: string,
): Promise<string> {
  const roleLabels = roles.map((value) => IMAGE_AD_REFERENCE_ROLES.find((role) => role.value === value)!.label);
  const response = await withRetry(() => getLLM().models.generateContent({
    model: FAST_MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: image.contentType, data: image.bytes.toString("base64") } },
        { text: [
          `Analyze this winning image ad from ${ad.brandName}.`,
          `Analyze ONLY these assigned inspiration roles: ${roleLabels.join(", ")}.`,
          "Extract concise, transferable creative patterns for a different brand. Do not repeat visible wording, branding, proprietary imagery, or a distinctive composition verbatim.",
          "Return exactly one JSON object: {\"summary\":\"2-4 sentences\",\"patterns\":[\"specific reusable pattern\"],\"avoidCopying\":[\"distinctive element that must not be copied\"]}.",
        ].join("\n") },
      ],
    }],
    config: { responseMimeType: "application/json", maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
  }));
  await recordUsage({
    feature: "image_ad_reference_analysis",
    model: FAST_MODEL,
    usage: response.usageMetadata,
    metadata: { batchId, competitorAdId: ad.id, roles },
  });
  const analysis = extractJsonObject<Record<string, unknown>>(response.text ?? "");
  return JSON.stringify(analysis);
}

async function saveImageAdReferencesImpl(
  batchId: string,
  selections: ImageAdReferenceSelection[],
): Promise<{ references: ImageAdReferenceSnapshot[] }> {
  const doc = await loadBatchDoc(batchId);
  // Concepts cite these references by id and were written from their analysis, so
  // swapping the set underneath them would leave every attribution stale.
  if (doc.candidates.length > 0) {
    throw new Error("References are locked once concepts are planned. Start a new batch to use a different set.");
  }

  const ids = [...new Set(selections.map((selection) => selection.adId))];
  const adsResult = ids.length
    ? await supabase.from("CompetitorAd").select("*").in("id", ids)
    : { data: [], error: null };
  if (adsResult.error) throw new Error(adsResult.error.message);
  const ads = (adsResult.data ?? []) as CompetitorAdRow[];
  const validationError = imageAdReferenceSelectionError(selections, ads);
  if (validationError) throw new Error(validationError);

  const previousById = new Map(doc.references.map((reference) => [reference.adId, reference]));
  const selectedAt = new Date().toISOString();
  const adById = new Map(ads.map((ad) => [ad.id, ad]));
  const references: ImageAdReferenceSnapshot[] = [];

  for (const selection of selections) {
    const ad = adById.get(selection.adId)!;
    const roles = [...new Set(selection.roles)].sort() as ImageAdReferenceRole[];
    const previous = previousById.get(ad.id);
    // Unchanged reference: keep the archived copy and analysis rather than
    // re-downloading the image and paying for another vision call. Only if the
    // stored copy is still measurable and still actually there — a snapshot from
    // before the quality check, or one whose file has gone, gets re-archived.
    const reusable = previous
      && JSON.stringify([...previous.roles].sort()) === JSON.stringify(roles)
      && !referenceNeedsRearchive(previous)
      && await storedImageExists(previous.archivedImageUrl);
    if (reusable) {
      references.push(previous!);
      continue;
    }

    const image = await fetchReferenceImage(ad.imageUrl!, ad.brandName);
    const analysis = await analyzeReferenceImage(ad, roles, image, batchId);
    const archivedImageUrl = (await saveImage({
      prefix: "image-ad-references",
      filename: `${randomUUID()}.${image.extension}`,
      bytes: image.bytes,
      contentType: image.contentType,
    })).url;
    references.push({
      adId: ad.id,
      provider: ad.provider,
      externalId: ad.externalId,
      brandName: ad.brandName,
      platform: ad.platform,
      sourceUrl: ad.sourceUrl,
      providerImageUrl: ad.imageUrl!,
      archivedImageUrl,
      copy: ad.copy,
      winnerEvidence: ad.winnerEvidence,
      evidenceReasons: ad.evidenceReasons,
      metrics: ad.metrics,
      selectedAt,
      roles,
      analysis,
      width: image.width,
      height: image.height,
      byteSize: image.bytes.byteLength,
    });
  }

  // Archiving + analysis can run for a while, so re-read the row immediately
  // before writing and patch only the references key onto the freshest doc.
  const freshDoc = await loadBatchDoc(batchId);
  freshDoc.references = references;
  const update = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(freshDoc) })
    .eq("id", batchId)
    .eq("type", IMAGE_AD_BATCH_TYPE);
  if (update.error) throw new Error(update.error.message);
  revalidatePath("/image-ads");
  revalidatePath(`/image-ads/${batchId}`);
  return { references };
}

// ─── Concepts and image generation ────────────────────────────────────────────

const MIN_GENERATED_SHORT_SIDE = 512;

interface BatchContext {
  sub: SubAvatarRow | null;
  angle: AngleRow | null;
  research: AvatarResearchRow | null;
  product: ProductRow | null;
  pipelineRunId: string | null;
  pipelineStages: Record<string, unknown>;
}

function trim(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function loadBatchContext(doc: ImageAdBatchDoc): Promise<BatchContext> {
  const [subRes, angleRes, researchRes, productRes, pipelineRes] = await Promise.all([
    supabase.from("SubAvatar").select("*").eq("id", doc.subAvatarId).maybeSingle(),
    supabase.from("Angle").select("*").eq("slug", doc.angleSlug).maybeSingle(),
    supabase.from("AvatarResearch").select("*").eq("subAvatarId", doc.subAvatarId).maybeSingle(),
    doc.productId
      ? supabase.from("Product").select("*").eq("id", doc.productId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Reuse the avatar's most recent Pipeline research where it exists. The bank
    // only reads it — it never starts, blocks on, or modifies a Pipeline run.
    supabase
      .from("Research")
      .select("id, drafts, createdAt")
      .eq("type", "pipeline")
      .like("drafts", `%${doc.subAvatarId}%`)
      .order("createdAt", { ascending: false })
      .limit(1),
  ]);

  let pipelineRunId: string | null = null;
  let pipelineStages: Record<string, unknown> = {};
  const pipelineRow = ((pipelineRes.data ?? []) as { id: string; drafts: string }[])[0];
  if (pipelineRow) {
    try {
      const parsed = JSON.parse(pipelineRow.drafts) as { subAvatarId?: string; stages?: Record<string, unknown> };
      if (parsed.subAvatarId === doc.subAvatarId && parsed.stages) {
        pipelineRunId = pipelineRow.id;
        pipelineStages = parsed.stages;
      }
    } catch {
      // A malformed pipeline doc just means no reusable research.
    }
  }

  return {
    sub: subRes.data as SubAvatarRow | null,
    angle: angleRes.data as AngleRow | null,
    research: researchRes.data as AvatarResearchRow | null,
    product: productRes.data as ProductRow | null,
    pipelineRunId,
    pipelineStages,
  };
}

function brandRulesBlock(ctx: BatchContext): string {
  const angle = ctx.angle;
  return [
    "BRAND AND ANGLE RULES (hard constraints):",
    angle ? `Angle: ${angle.name}. Required keyword: ${angle.requiredKeyword}. Mechanism: ${angle.mechanism}.` : "",
    angle?.bannedMechanism ? `Never claim this mechanism: ${angle.bannedMechanism}.` : "",
    angle?.silhouette ? `Silhouette: ${angle.silhouette}. Colorway: ${angle.colorway}.` : "",
    ctx.product ? `Product: ${ctx.product.name}. ${trim(ctx.product.description, 400)}` : "",
    `Never use these words in any copy: ${BANNED_WORDS.join(", ")}.`,
    `CTA must be one of: ${ALLOWED_CTAS.join(" / ")}.`,
    "No medical claims, no before/after promises, no weight-loss framing, no timers or countdowns.",
    "Never invent testimonials, customer names, reviews, star ratings, statistics, or stock levels. Quote a customer only if the exact words appear in the research above.",
  ].filter(Boolean).join("\n");
}

function researchBlock(ctx: BatchContext): string {
  const research = ctx.research;
  const parts = [
    ctx.sub?.shortDesc ? `Avatar: ${ctx.sub.name} — ${ctx.sub.shortDesc}` : ctx.sub ? `Avatar: ${ctx.sub.name}` : "",
    research ? `Pain points: ${trim(research.painPoints, 900)}` : "",
    research ? `Desires: ${trim(research.desires, 700)}` : "",
    research ? `Objections: ${trim(research.objections, 700)}` : "",
    research ? `Daily language: ${trim(research.dailyLanguage, 700)}` : "",
    research ? `Trigger moments: ${trim(research.triggers, 500)}` : "",
    research ? `Social proof: ${trim(research.socialProof, 400)}` : "",
  ].filter(Boolean);
  return parts.length ? `AVATAR RESEARCH:\n${parts.join("\n")}` : "";
}

const REUSED_STAGE_CAPS: Record<string, number> = {
  rootCause: 1200,
  brandDna: 1200,
  copyArsenal: 2500,
  creativeBriefs: 2500,
};

function pipelineBlock(ctx: BatchContext): string {
  const blocks = Object.entries(REUSED_STAGE_CAPS)
    .filter(([key]) => ctx.pipelineStages[key] != null)
    .map(([key, cap]) => `${key}: ${trim(ctx.pipelineStages[key], cap)}`);
  return blocks.length ? `SAVED PIPELINE RESEARCH FOR THIS AVATAR (reuse, do not contradict):\n${blocks.join("\n\n")}` : "";
}

function referenceBlock(references: ImageAdReferenceSnapshot[]): string {
  const entries = references.map((reference) => ({
    referenceId: reference.adId,
    competitor: reference.brandName,
    roles: reference.roles,
    analysis: trim(reference.analysis, 1200),
  }));
  return [
    "COMPETITOR REFERENCE PATTERNS — usable ONLY for the roles assigned to each reference:",
    JSON.stringify(entries),
    "Adapt the transferable pattern only. Never reproduce competitor branding, wording, proprietary imagery, or a distinctive composition.",
  ].join("\n");
}

function conceptText(concept: ImageAdConcept): string {
  return `${concept.headline} ${concept.bodyCopy} ${concept.cta}`;
}

// The response schema pins the shape, so the planner cannot hand back a bare
// array or rename the list — both of which it does when left to free-form JSON.
const CONCEPT_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING },
          execution: { type: Type.STRING },
          headline: { type: Type.STRING },
          bodyCopy: { type: Type.STRING },
          cta: { type: Type.STRING },
          visualInstructions: { type: Type.STRING },
          rationale: { type: Type.STRING },
          sourceReferenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          rolesUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["direction", "execution", "headline", "bodyCopy", "cta", "visualInstructions", "rationale", "sourceReferenceIds", "rolesUsed"],
      },
    },
  },
  required: ["concepts"],
};

// Belt and braces around the schema: accept the list whether it arrives as
// {concepts: [...]}, a bare array, or under some other key.
function parseConceptList(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    try {
      parsed = extractJsonObject<unknown>(text);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.concepts)) return record.concepts;
    const firstList = Object.values(record).find((value) => Array.isArray(value));
    if (Array.isArray(firstList)) return firstList;
  }
  return [];
}

function coerceCta(value: string): string {
  const match = ALLOWED_CTAS.find((cta) => cta.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  return match ?? ALLOWED_CTAS[0];
}

function toConcept(raw: unknown, references: ImageAdReferenceSnapshot[]): ImageAdConcept {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string, fallback = "") => typeof value[key] === "string" ? (value[key] as string).trim() : fallback;
  const validIds = new Set(references.map((reference) => reference.adId));
  const sourceReferenceIds = Array.isArray(value.sourceReferenceIds)
    ? [...new Set(value.sourceReferenceIds.filter((id): id is string => typeof id === "string" && validIds.has(id)))]
    : [];
  // Roles are only meaningful if the cited reference was actually assigned them.
  const allowedRoles = new Set(
    references.filter((reference) => sourceReferenceIds.includes(reference.adId)).flatMap((reference) => reference.roles),
  );
  const rolesUsed = Array.isArray(value.rolesUsed)
    ? [...new Set(value.rolesUsed.filter((role): role is ImageAdReferenceRole =>
        typeof role === "string" && allowedRoles.has(role as ImageAdReferenceRole)))]
    : [];
  return {
    direction: text("direction", "Untitled direction"),
    execution: text("execution", "Execution"),
    headline: text("headline"),
    bodyCopy: text("bodyCopy"),
    // The allowed CTA list is a hard brand rule, and the planner does invent
    // variants, so coerce rather than trust the prompt.
    cta: coerceCta(text("cta")),
    visualInstructions: text("visualInstructions"),
    rationale: text("rationale"),
    // Classified by what it actually cites, not by what it claims to be.
    source: sourceReferenceIds.length ? "reference_informed" : "original",
    sourceReferenceIds,
    rolesUsed,
  };
}

async function planImageAdConceptsImpl(batchId: string): Promise<{
  candidates: ImageAdCandidate[];
  usedPipelineRunId: string | null;
}> {
  const doc = await loadBatchDoc(batchId);
  if (!imageAdReferencesReady(doc.references)) {
    throw new Error("Save 3–5 winning references from at least two competitors before planning concepts.");
  }
  if (doc.candidates.some((candidate) => candidate.status === "ready")) {
    throw new Error("This batch already has rendered images. Re-planning would discard them — start a new batch instead.");
  }

  const ctx = await loadBatchContext(doc);
  const mix = planSourceMix(doc.targetCount);
  const referenceTarget = mix.filter((source) => source === "reference_informed").length;
  const directionSizes = planDirectionSizes(doc.targetCount);

  const prompt = [
    `Plan exactly ${doc.targetCount} distinct static image ad concepts for one avatar and one angle.`,
    `Structure them as ${directionSizes.length} message directions with these execution counts: ${directionSizes.join(", ")}.`,
    `Exactly ${referenceTarget} concepts must be reference-informed (they cite one or more referenceId values and the roles they borrowed).`,
    `The remaining ${doc.targetCount - referenceTarget} must be original research-led experiments with an empty sourceReferenceIds array.`,
    "Vary the message, hook, scene, and layout meaningfully. Two concepts that differ only in wording are a wasted slot.",
    `Every ad renders at ${doc.format}. Headlines must be 8 words or fewer and render legibly at thumbnail size.`,
    "",
    brandRulesBlock(ctx),
    "",
    researchBlock(ctx),
    "",
    pipelineBlock(ctx),
    "",
    referenceBlock(doc.references),
    "",
    "visualInstructions is the brief an image model renders from: describe the scene, subject, framing, lighting, composition, colour, and exactly where the headline and CTA sit. Do not name competitors in it.",
    `Return exactly one JSON object: {"concepts":[{"direction":"","execution":"","headline":"","bodyCopy":"","cta":"","visualInstructions":"","rationale":"","source":"reference_informed|original","sourceReferenceIds":[],"rolesUsed":[]}]} with ${doc.targetCount} entries.`,
  ].filter((line) => line !== undefined).join("\n");

  const response = await withRetry(() => getLLM().models.generateContent({
    model: DEFAULT_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: CONCEPT_PLAN_SCHEMA,
      maxOutputTokens: 32000,
      // Thinking bills at the output rate and shares the output budget; the
      // concept list needs the room more than the reasoning does.
      thinkingConfig: { thinkingBudget: 2048 },
    },
  }));
  await recordUsage({
    feature: "image_ad_concepts",
    model: DEFAULT_MODEL,
    usage: response.usageMetadata,
    metadata: { batchId, targetCount: doc.targetCount, usedPipelineRunId: ctx.pipelineRunId },
  });

  const rawConcepts = parseConceptList(response.text ?? "");
  if (rawConcepts.length < doc.targetCount) {
    const finish = response.candidates?.[0]?.finishReason;
    throw new Error(
      `The planner returned ${rawConcepts.length} of ${doc.targetCount} concepts${finish && finish !== "STOP" ? ` (stopped early: ${finish})` : ""}. Try again.`,
    );
  }

  const candidates: ImageAdCandidate[] = rawConcepts.slice(0, doc.targetCount).map((raw, slot) => {
    const concept = toConcept(raw, doc.references);
    const claims = scanClaims(conceptText(concept));
    return {
      slot,
      concept,
      status: "planned",
      imageUrl: null,
      width: null,
      height: null,
      attempts: 0,
      error: null,
      generatedAt: null,
      claimStatus: claims.status,
      claimFlags: claims.flags.map((flag) => flag.phrase),
    };
  });

  const missingBrief = candidates.filter((candidate) => !candidate.concept.visualInstructions || !candidate.concept.headline);
  if (missingBrief.length) {
    throw new Error(`${missingBrief.length} concepts came back without a headline or visual brief. Run the planner again.`);
  }

  const freshDoc = await loadBatchDoc(batchId);
  freshDoc.candidates = candidates;
  const update = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(freshDoc) })
    .eq("id", batchId)
    .eq("type", IMAGE_AD_BATCH_TYPE);
  if (update.error) throw new Error(update.error.message);
  revalidatePath(`/image-ads/${batchId}`);

  return { candidates, usedPipelineRunId: ctx.pipelineRunId };
}

// Candidates are written back one slot at a time. Re-read immediately before
// writing so a sibling that finished while this one was rendering is not
// clobbered, which narrows the lost-update window to the merge itself — the same
// trade the Pipeline doc writer makes.
//
// This deliberately is NOT a compare-and-swap. PostgREST puts filters in the URL,
// so a filter carrying the previous document is rejected as a Bad Request once
// the doc passes ~16KB, which every real batch does.
async function patchCandidate(
  batchId: string,
  slot: number,
  patch: (candidate: ImageAdCandidate) => ImageAdCandidate,
): Promise<ImageAdCandidate> {
  const doc = await loadBatchDoc(batchId);
  const index = doc.candidates.findIndex((candidate) => candidate.slot === slot);
  if (index === -1) throw new Error(`Slot ${slot} is not part of this batch.`);
  const next = patch(doc.candidates[index]!);
  doc.candidates[index] = next;
  const update = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(doc) })
    .eq("id", batchId)
    .eq("type", IMAGE_AD_BATCH_TYPE);
  if (update.error) throw new Error(update.error.message);
  return next;
}

function renderPrompt(doc: ImageAdBatchDoc, concept: ImageAdConcept, ctx: BatchContext): string {
  return [
    `Create a finished ${doc.format} static advertising image, ${imageAdExportSize(doc.format).width} x ${imageAdExportSize(doc.format).height} pixels. Keep the headline and CTA clear of the outer edges.`,
    ctx.product ? `Product: ${ctx.product.name}.${ctx.product.imagePath ? " The attached image is the exact product — match it faithfully." : ""}` : "",
    "",
    "VISUAL BRIEF:",
    concept.visualInstructions,
    imageAdBrandingPrompt(doc.format),
    "",
    // Only the headline and CTA go into the pixels. Image models spell short
    // display text reliably and long sentences badly, and the body copy belongs
    // in the ad's primary text field anyway.
    "THE ONLY TEXT IN THE IMAGE, spelled exactly as written:",
    `Headline: ${concept.headline}`,
    `CTA button: ${concept.cta}`,
    "",
    "Render no other words anywhere — no body copy, captions, badges, prices, or fine print. Typography must be clean, correctly spelled, and readable at thumbnail size. No watermark, no competitor logos.",
    ctx.angle?.colorway ? `Keep the palette consistent with: ${ctx.angle.colorway}.` : "",
  ].filter(Boolean).join("\n");
}

async function generateImageAdCandidateImpl(
  batchId: string,
  slot: number,
  options?: { force?: boolean },
): Promise<{ candidate: ImageAdCandidate }> {
  const doc = await loadBatchDoc(batchId);
  const existing = doc.candidates.find((candidate) => candidate.slot === slot);
  if (!existing) throw new Error(`Slot ${slot} is not part of this batch.`);
  // Idempotent: a repeated click or a retried loop never re-renders finished work.
  if (existing.status === "ready" && existing.imageUrl && !options?.force) return { candidate: existing };

  await patchCandidate(batchId, slot, (candidate) => ({
    ...candidate,
    status: "generating",
    error: null,
    attempts: candidate.attempts + 1,
  }));

  try {
    const logos = await loadCellumoveLogos();
    const ctx = await loadBatchContext(doc);
    const parts: Part[] = [];
    // Anchor product fidelity on the real product photo when the batch has one.
    if (ctx.product?.imagePath) {
      try {
        const productBytes = await readStoredImage(ctx.product.imagePath);
        const probe = probeImage(productBytes);
        if (probe) {
          parts.push({ inlineData: { mimeType: `image/${probe.format}`, data: productBytes.toString("base64") } });
        }
      } catch {
        // A missing product image is not worth failing the render over.
      }
    }
    parts.push({ text: renderPrompt(doc, existing.concept, ctx) });

    const profile = imageAdModelProfile();
    // The model occasionally answers with no image, or one that does not decode.
    // That is a coin-flip, not a verdict on the concept, so ask once more before
    // calling the slot failed. Provider errors have their own retry in withRetry.
    let rendered: { bytes: Buffer; width: number; height: number; format: string } | null = null;
    let lastProblem = "";
    for (let attempt = 0; attempt < 2 && !rendered; attempt += 1) {
      const response = await withRetry(() => getLLM().models.generateContent({
        model: profile.model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: doc.format,
            ...(profile.imageSize ? { imageSize: profile.imageSize } : {}),
          },
        },
      }));
      await recordUsage({
        feature: "image_ad_generation",
        model: profile.model,
        usage: response.usageMetadata,
        costUsdOverride: profile.costUsd,
        metadata: { batchId, slot, attempt, imageSize: profile.imageSize ?? "default" },
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        const finish = response.candidates?.[0]?.finishReason;
        const text = response.text?.trim();
        lastProblem = `The image model returned no image${finish && finish !== "STOP" ? ` (${finish})` : ""}${text ? `: ${trim(text, 200)}` : "."}`;
        continue;
      }
      const bytes = Buffer.from(imagePart.inlineData.data, "base64");
      const probe = probeImage(bytes);
      if (!probe) {
        lastProblem = "The generated file did not decode as a usable image.";
        continue;
      }
      if (Math.min(probe.width, probe.height) < MIN_GENERATED_SHORT_SIDE) {
        lastProblem = `The generated image is only ${probe.width}×${probe.height} — below the ${MIN_GENERATED_SHORT_SIDE}px minimum.`;
        continue;
      }
      rendered = { bytes, width: probe.width, height: probe.height, format: probe.format };
    }
    if (!rendered) throw new Error(lastProblem || "The image model returned no image.");

    // Brand the fitted image before compression. Even a compression fallback
    // must keep the real logo in the saved/downloaded pixels.
    const branded = await applyCellumoveLogo(rendered.bytes, doc.format, imageAdExportSize(doc.format), logos);
    const finalized = await finalizeAdImage(branded.bytes, null) ?? branded;
    const output = { ...finalized, extension: "png", contentType: "image/png" };

    const saved = await saveImage({
      prefix: "image-ad-candidates",
      filename: `${batchId}-${String(slot).padStart(2, "0")}-${randomUUID()}.${output.extension}`,
      bytes: output.bytes,
      contentType: output.contentType,
    });

    const candidate = await patchCandidate(batchId, slot, (current) => ({
      ...current,
      status: "ready",
      imageUrl: saved.url,
      width: output.width,
      height: output.height,
      error: null,
      generatedAt: new Date().toISOString(),
      logoAppliedAt: new Date().toISOString(),
      unbrandedImageUrl: undefined,
    }));
    return { candidate };
  } catch (reason) {
    // Persist the failure instead of throwing: one bad slot must not stop the
    // batch, and the saved message is what the retry button acts on.
    const message = friendlyError(reason);
    // A failed *re*generate keeps the image the slot already had.
    const candidate = await patchCandidate(batchId, slot, (current) => ({
      ...current,
      status: current.imageUrl ? "ready" : "failed",
      error: trim(message, 300),
    }));
    return { candidate };
  }
}

// ─── Public actions ───────────────────────────────────────────────────────────

// Next.js replaces thrown server-action messages with a generic digest in
// production. Most failures here are instructions to the strategist ("that
// reference is 300px — pick another"), so they travel back as data instead.
// Auth stays outside the wrapper: its redirect must propagate as a throw.
async function attempt<T extends object>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (reason) {
    return { ok: false, error: friendlyError(reason) };
  }
}

export async function createImageAdBatch(
  input: Parameters<typeof createImageAdBatchImpl>[0],
): Promise<ActionResult<{ batchId: string }>> {
  await requireStrategist();
  return attempt(() => createImageAdBatchImpl(input));
}

export async function saveImageAdReferences(
  batchId: string,
  selections: ImageAdReferenceSelection[],
): Promise<ActionResult<{ references: ImageAdReferenceSnapshot[] }>> {
  await requireStrategist();
  return attempt(() => saveImageAdReferencesImpl(batchId, selections));
}

export async function planImageAdConcepts(batchId: string): Promise<ActionResult<{
  candidates: ImageAdCandidate[];
  usedPipelineRunId: string | null;
}>> {
  await requireStrategist();
  return attempt(() => planImageAdConceptsImpl(batchId));
}

export async function generateImageAdCandidate(
  batchId: string,
  slot: number,
  options?: { force?: boolean },
): Promise<ActionResult<{ candidate: ImageAdCandidate }>> {
  await requireStrategist();
  return attempt(() => generateImageAdCandidateImpl(batchId, slot, options));
}

// Existing renders can be branded without another paid model request. Keep the
// old blob and URL, and only mark the new version after storage succeeds.
export async function brandImageAdCandidate(
  batchId: string,
  slot: number,
): Promise<ActionResult<{ candidate: ImageAdCandidate }>> {
  await requireStrategist();
  return attempt(async () => {
    const doc = await loadBatchDoc(batchId);
    const existing = doc.candidates.find((candidate) => candidate.slot === slot);
    if (!existing?.imageUrl || existing.status !== "ready") throw new Error("Generate this image before adding the logo.");
    if (existing.logoAppliedAt) return { candidate: existing };
    const originalUrl = existing.imageUrl;
    const source = await readStoredImage(originalUrl);
    const branded = await applyCellumoveLogo(source, doc.format, imageAdExportSize(doc.format));
    const output = await finalizeAdImage(branded.bytes, null) ?? branded;
    const saved = await saveImage({
      prefix: "image-ad-candidates",
      filename: `${batchId}-${String(slot).padStart(2, "0")}-${randomUUID()}.png`,
      bytes: output.bytes,
      contentType: "image/png",
    });
    const candidate = await patchCandidate(batchId, slot, (current) => {
      if (current.imageUrl !== originalUrl || current.status !== "ready" || current.logoAppliedAt) {
        throw new Error("This image changed while the logo was being added. Refresh the batch to see the latest version.");
      }
      return {
        ...current,
        unbrandedImageUrl: originalUrl,
        imageUrl: saved.url,
        width: output.width,
        height: output.height,
        logoAppliedAt: new Date().toISOString(),
        error: null,
      };
    });
    revalidatePath(`/image-ads/${batchId}`);
    revalidatePath("/image-ads");
    return { candidate };
  });
}

// Removes the batch record. Archived and rendered image files are left in
// storage: other batches never share them, but deleting blobs is not reversible
// and a mistaken click should not be either.
export async function deleteImageAdBatch(batchId: string): Promise<ActionResult<{ deleted: true }>> {
  await requireStrategist();
  return attempt(async () => {
    await loadBatchDoc(batchId);
    const res = await supabase.from("Research").delete().eq("id", batchId).eq("type", IMAGE_AD_BATCH_TYPE);
    if (res.error) throw new Error(res.error.message);
    revalidatePath("/image-ads");
    return { deleted: true as const };
  });
}
