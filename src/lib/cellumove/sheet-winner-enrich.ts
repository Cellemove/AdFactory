// Core creative-enrichment for one imported sheet winner: fetch its FB post,
// persist the creative (fbcdn URLs expire), and have Gemini extract the same
// fields the curated Winners library holds. Shared by the /winners "✨ analyze"
// server action AND the batch script (scripts/analyze-sheet-winners.ts) so the
// two can never drift.
//
// This module talks to FB + storage + Gemini but NOT to the Research doc — the
// caller owns load/merge/save (and revalidation, when in Next).

import { randomUUID } from "node:crypto";
import { getLLM, FAST_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { saveImage } from "@/lib/storage";
import { harvestFbPost, downloadFbImage, isFbPostUrl } from "@/lib/fb-post";
import { sheetWinnerKey, type SheetWinner, type SheetWinnerEnrichment } from "./sheet-winners";

const ENRICH_PROMPT = `You are analyzing one of OUR OWN winning paid-social ads (CelluMove — 3D-shaping compression leggings).
You are given the ad creative image and, when available, the post's primary text.

Return ONLY a JSON object with these fields:
{
  "adType": "static" | "video" — "video" ONLY if the image clearly shows video cues (play button overlay, timeline/scrubber, Reel badge). Otherwise "static".
  "headline": the EXACT most prominent text rendered IN the creative — verbatim, original language/casing. Empty string if none.
  "visualConcept": 1-2 sentences describing imagery, casting, composition, setting, and any product cue,
  "hookType": closest of: "question" | "transformation" | "social-proof" | "before-after" | "stat" | "demo" | "testimonial" | "list" | "story" | "promo" | "contrarian",
  "funnel": "TOFU" | "MOFU" | "BOFU" — TOFU=cold/awareness, MOFU=problem-aware, BOFU=offer/promo-heavy
}
Do not invent text — only report what is visibly rendered or provided.`;

export async function extractWinnerEnrichment(winner: SheetWinner): Promise<SheetWinnerEnrichment> {
  if (!isFbPostUrl(winner.postLink)) throw new Error("This ad has no usable Facebook post link.");

  // 1. Harvest the post: creative URL + primary text.
  const post = await harvestFbPost(winner.postLink!);
  if (!post.imageUrl) {
    throw new Error("Facebook did not expose this post's creative (post removed/private, or a temporary block). Try again.");
  }

  // 2. Persist the creative NOW — fbcdn URLs are signed and expire within days.
  const img = await downloadFbImage(post.imageUrl);
  if (!img) throw new Error("Could not download the creative image from Facebook's CDN. Try again.");
  const ext = img.contentType === "image/png" ? ".png" : img.contentType === "image/webp" ? ".webp" : ".jpg";
  const { url: imagePath } = await saveImage({
    prefix: "winners-import",
    filename: `${randomUUID()}${ext}`,
    bytes: img.bytes,
    contentType: img.contentType,
  });

  // 3. Gemini reads the creative (+ primary text) into library-style fields.
  //
  // This runs on the FAST tier with thinking OFF, and that pairing is deliberate:
  // the task is a bounded read of one image into five fixed fields (~100 output
  // tokens), with no reasoning step that thinking would improve. On Pro this was
  // the single most expensive feature in the app — not from its output, but
  // because thinking bills at the output rate and it spent ~6x more tokens
  // reasoning than answering. Pro cannot switch thinking off; Flash can.
  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: FAST_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: img.contentType, data: img.bytes.toString("base64") } },
          {
            text: [
              ENRICH_PROMPT,
              "",
              `AD NAME: ${winner.adName}`,
              `SHEET ANGLE LABEL: ${winner.angle || "(none)"}`,
              post.primaryText ? `PRIMARY TEXT (verbatim): ${post.primaryText}` : "PRIMARY TEXT: not exposed (likely a video post).",
            ].join("\n"),
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
  });
  await recordUsage({
    feature: "winners_import_enrich",
    model: FAST_MODEL,
    usage: resp.usageMetadata,
    metadata: { key: sheetWinnerKey(winner) },
  });

  const text = resp.text ?? "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const raw = JSON.parse(body) as Partial<SheetWinnerEnrichment>;

  // Funnel: the ad name is the source of truth when it encodes MOFU/BOFU/TOFU.
  const nameFunnel = winner.adName.match(/\b(TOFU|MOFU|BOFU)\b/i)?.[1]?.toUpperCase();
  return {
    adType: raw.adType === "video" ? "video" : "static",
    headline: (raw.headline ?? "").trim(),
    visualConcept: (raw.visualConcept ?? "").trim(),
    hookType: (raw.hookType ?? "").trim(),
    funnel: nameFunnel ?? (["TOFU", "MOFU", "BOFU"].includes(raw.funnel as string) ? (raw.funnel as string) : ""),
    primaryText: (post.primaryText ?? "").trim(),
    imagePath,
    enrichedAt: new Date().toISOString(),
  };
}
