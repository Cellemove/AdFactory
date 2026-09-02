"use server";

import { z } from "zod";
import { requireStrategist } from "@/lib/authorization";
import { extractJsonObject, runAgent } from "@/lib/cellumove/agents";
import { ScriptFiveDSchema } from "@/lib/cellumove/script-studio";
import type { AngleRow, Json, ProductRow, SubAvatarRow } from "@/lib/database.types";
import { newId, supabase, unwrapOpt } from "@/lib/db";

const StrategistIdeaSchema = z.object({
  fiveD: ScriptFiveDSchema,
  angleCandidates: z.array(z.object({
    angleId: z.string().min(1),
    angle: z.string().min(1),
    rationale: z.string().min(1),
  }).strict()).min(2).max(5),
  hookDirections: z.array(z.object({
    hook: z.string().min(1),
    direction: z.string().min(1),
  }).strict()).min(3).max(8),
}).strict();

export type StrategistIdeaResult = z.infer<typeof StrategistIdeaSchema>;

export async function analyzeRawIdea(input: { idea: string; productId: string; format: string }): Promise<StrategistIdeaResult> {
  const actor = await requireStrategist();
  const parsed = z.object({
    idea: z.string().trim().min(5).max(4000),
    productId: z.string().min(1),
    format: z.string().trim().min(1).max(80),
  }).parse(input);
  const [productRaw, angleRows, avatarRows] = await Promise.all([
    unwrapOpt(await supabase.from("Product").select("*").eq("id", parsed.productId).maybeSingle()),
    supabase.from("Angle").select("*").order("order"),
    supabase.from("SubAvatar").select("*").order("name"),
  ]);
  const product = productRaw as ProductRow | null;
  if (!product) throw new Error("Choose a valid product before running the strategist.");
  const angles = (angleRows.data ?? []) as AngleRow[];
  const avatars = (avatarRows.data ?? []) as SubAvatarRow[];
  const instruction = [
    "You are AdFactory's senior Creative Strategist. Analyze one raw ad idea without creating a script project.",
    "Return two to five viable angles selected only from the allowed angle IDs, and three to eight distinct hook directions.",
    "Define the complete 5D strategy: avatar, angle, videoFormat, identityLevel, and dynamismLevel. Do not invent product claims.",
    "Return JSON only in this shape:",
    '{"fiveD":{"avatar":"string","angle":"string","videoFormat":"string","identityLevel":"string","dynamismLevel":"string"},"angleCandidates":[{"angleId":"allowed ID","angle":"name","rationale":"why it fits"}],"hookDirections":[{"hook":"customer-facing hook","direction":"strategic explanation"}]}',
  ].join("\n");
  const text = await runAgent({
    role: "strategist",
    instruction,
    context: JSON.stringify({
      idea: parsed.idea,
      product: { id: product.id, name: product.name, description: product.description, code: product.code },
      requestedFormat: parsed.format,
      allowedAngles: angles.map((angle) => ({ id: angle.id, name: angle.name, mechanism: angle.mechanism, requiredKeyword: angle.requiredKeyword })),
      researchedAvatars: avatars.map((avatar) => ({ name: avatar.name, angleId: avatar.angleId, description: avatar.shortDesc })),
    }),
    json: true,
    feature: "standalone_creative_strategist",
    maxOutputTokens: 8192,
    thinkingBudget: 2048,
  });
  const result = StrategistIdeaSchema.parse(extractJsonObject<unknown>(text));
  const allowedAngleIds = new Set(angles.map((angle) => angle.id));
  if (result.angleCandidates.some((candidate) => !allowedAngleIds.has(candidate.angleId))) {
    throw new Error("The strategist returned an angle outside the approved library. Run it again.");
  }
  await supabase.from("Research").insert({
    id: newId(),
    type: "strategist_idea",
    angleSlug: null,
    focus: parsed.idea,
    drafts: JSON.stringify(result),
    status: "saved",
    queryPlan: { productId: product.id, format: parsed.format } as Json,
    notes: `Standalone strategist run by ${actor.username}`,
    createdAt: new Date().toISOString(),
  });
  return result;
}

