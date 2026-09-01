"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";
import { getLLM, FAST_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { saveImage } from "@/lib/storage";

const Funnel = z.enum(["TOFU", "MOFU", "BOFU"]);

const CreateWinnerSchema = z.object({
  angleSlug: z.string().min(1),
  adName: z.string().min(2).max(120),
  funnel: Funnel,
  adType: z.enum(["static", "video"]).optional(),
  headline: z.string().min(1),
  visualConcept: z.string().min(1),
  hookType: z.string().optional().nullable(),
  imagePath: z.string().optional().nullable(),
  metrics: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createWinningAd(input: z.infer<typeof CreateWinnerSchema>) {
  const parsed = CreateWinnerSchema.parse(input);
  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("slug", parsed.angleSlug).maybeSingle(),
  ) as { id: string } | null;
  if (!angle) throw new Error(`Unknown angle: ${parsed.angleSlug}`);
  const created = unwrap(
    await supabase
      .from("WinningAd")
      .insert({
        id: newId(),
        angleId: angle.id,
        adName: parsed.adName,
        funnel: parsed.funnel,
        adType: parsed.adType ?? "static",
        headline: parsed.headline,
        visualConcept: parsed.visualConcept,
        hookType: parsed.hookType ?? null,
        imagePath: parsed.imagePath ?? null,
        metrics: parsed.metrics ?? null,
        notes: parsed.notes ?? null,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );
  revalidatePath("/winners");
  return created;
}

const UpdateWinnerSchema = z.object({
  id: z.string().min(1),
  angleSlug: z.string().min(1),
  adName: z.string().min(2).max(120),
  funnel: Funnel,
  adType: z.enum(["static", "video"]).optional(),
  headline: z.string().min(1),
  visualConcept: z.string().min(1),
  hookType: z.string().optional().nullable(),
  imagePath: z.string().optional().nullable(),
  metrics: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function updateWinningAd(input: z.infer<typeof UpdateWinnerSchema>) {
  const parsed = UpdateWinnerSchema.parse(input);
  const angle = unwrapOpt(
    await supabase.from("Angle").select("*").eq("slug", parsed.angleSlug).maybeSingle(),
  ) as { id: string } | null;
  if (!angle) throw new Error(`Unknown angle: ${parsed.angleSlug}`);
  const updated = unwrap(
    await supabase
      .from("WinningAd")
      .update({
        angleId: angle.id,
        adName: parsed.adName,
        funnel: parsed.funnel,
        adType: parsed.adType ?? "static",
        headline: parsed.headline,
        visualConcept: parsed.visualConcept,
        hookType: parsed.hookType ?? null,
        imagePath: parsed.imagePath ?? null,
        metrics: parsed.metrics ?? null,
        notes: parsed.notes ?? null,
      })
      .eq("id", parsed.id)
      .select("*")
      .single(),
  );
  revalidatePath("/winners");
  return updated;
}

export async function deleteWinningAd(id: string) {
  const { error } = await supabase.from("WinningAd").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/winners");
}

// ─── Image extraction ────────────────────────────────────────────────────────
// User uploads a winning-ad screenshot; we persist it under public/uploads and
// hand it to Gemini for structured metadata extraction. The user reviews the
// auto-filled fields before saving.

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const EXTRACTION_PROMPT = `You are analyzing a winning paid social ad (Facebook/Instagram/TikTok creative).
Extract structured metadata for our internal ads library.

Return ONLY a JSON object with these fields:
{
  "adName": short canonical name (3-6 words, kebab-case-friendly, no punctuation) capturing the core concept,
  "funnel": "TOFU" | "MOFU" | "BOFU" — TOFU=awareness/cold, MOFU=consideration/problem-aware, BOFU=decision/promo,
  "adType": "static" | "video" — set to "video" ONLY if the image clearly shows video cues (a centered play button overlay, a timeline/scrubber, a Reel/TikTok badge, a frame grab with "VIDEO" text). Otherwise default to "static".
  "headline": the EXACT headline text shown in the ad — verbatim, with original punctuation and casing,
  "visualConcept": 1-2 sentences describing imagery, casting, composition, setting, color, and any product cue,
  "hookType": short label — choose the closest of: "question" | "transformation" | "social-proof" | "before-after" | "stat" | "demo" | "testimonial" | "list" | "story" | "promo" | "contrarian"
}

If a field genuinely cannot be determined from the image, return an empty string for that field.
Do not invent a headline — only return what is visibly rendered as text in the ad.`;

export interface ExtractedWinner {
  imagePath: string;
  adName: string;
  funnel: "TOFU" | "MOFU" | "BOFU";
  adType: "static" | "video";
  headline: string;
  visualConcept: string;
  hookType: string;
}

export async function extractWinnerFromImage(formData: FormData): Promise<ExtractedWinner> {
  const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("No image file uploaded.");
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}. Use PNG, JPEG, WEBP, or GIF.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB).`);
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".png";
  const filename = `${randomUUID()}${safeExt}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { url: imagePath } = await saveImage({
    prefix: "winners",
    filename,
    bytes,
    contentType: file.type,
  });

  // Bounded read of one creative into fixed fields — same shape as the sheet
  // winners enricher, so it takes the same tier: fast model, thinking off.
  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: FAST_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: file.type, data: bytes.toString("base64") } },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  await recordUsage({
    feature: "extraction",
    model: FAST_MODEL,
    usage: resp.usageMetadata,
  });

  const text = resp.text ?? "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  if (!body) throw new Error("Gemini returned no extraction output.");
  const raw = JSON.parse(body) as Partial<ExtractedWinner>;

  const funnelVal = ["TOFU", "MOFU", "BOFU"].includes(raw.funnel as string)
    ? (raw.funnel as "TOFU" | "MOFU" | "BOFU")
    : "MOFU";

  const adTypeVal: "static" | "video" = raw.adType === "video" ? "video" : "static";

  return {
    imagePath,
    adName: raw.adName ?? "",
    funnel: funnelVal,
    adType: adTypeVal,
    headline: raw.headline ?? "",
    visualConcept: raw.visualConcept ?? "",
    hookType: raw.hookType ?? "",
  };
}
