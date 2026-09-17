// Shape and defaults for an AI Ads Image Bank batch. Lives outside the server
// action file because "use server" modules may only export async functions, and
// both the server and the client pickers need these constants.
import type { ImageAdCandidate } from "./image-ad-concepts";
import type { ImageAdReferenceSnapshot } from "./image-ad-references";

// Each batch is a Research row of this type — the same convention Pipeline, Spy
// and Excavation use. A batch is independent of Pipeline: it owns its avatar,
// angle, product, and the BrandSearch references it was built from.
export const IMAGE_AD_BATCH_TYPE = "image_ad_batch";

export const IMAGE_AD_TARGET_COUNTS = [20, 25, 30] as const;
export const DEFAULT_IMAGE_AD_TARGET_COUNT = 25;

export const IMAGE_AD_FORMATS = [
  { value: "4:5", label: "4:5 portrait · 1080 × 1350" },
  { value: "1:1", label: "1:1 square · 1080 × 1080" },
  { value: "9:16", label: "9:16 story · 1080 × 1920" },
] as const;
export const DEFAULT_IMAGE_AD_FORMAT = "4:5";

export interface ImageAdBatchDoc {
  subAvatarId: string;
  angleSlug: string;
  productId: string | null;
  label: string;
  targetCount: number;
  format: string;
  references: ImageAdReferenceSnapshot[];
  candidates: ImageAdCandidate[];
}

export function normalizeTargetCount(value: unknown): number {
  return IMAGE_AD_TARGET_COUNTS.includes(value as (typeof IMAGE_AD_TARGET_COUNTS)[number])
    ? (value as number)
    : DEFAULT_IMAGE_AD_TARGET_COUNT;
}

export function normalizeFormat(value: unknown): string {
  return IMAGE_AD_FORMATS.some((format) => format.value === value) ? (value as string) : DEFAULT_IMAGE_AD_FORMAT;
}

export function emptyImageAdBatchDoc(): ImageAdBatchDoc {
  return {
    subAvatarId: "",
    angleSlug: "",
    productId: null,
    label: "",
    targetCount: DEFAULT_IMAGE_AD_TARGET_COUNT,
    format: DEFAULT_IMAGE_AD_FORMAT,
    references: [],
    candidates: [],
  };
}

export function parseImageAdBatchDoc(raw: string): ImageAdBatchDoc {
  try {
    const d = JSON.parse(raw) as Partial<ImageAdBatchDoc>;
    return {
      subAvatarId: d.subAvatarId ?? "",
      angleSlug: d.angleSlug ?? "",
      productId: d.productId ?? null,
      label: typeof d.label === "string" ? d.label : "",
      targetCount: normalizeTargetCount(d.targetCount),
      format: normalizeFormat(d.format),
      references: Array.isArray(d.references) ? d.references : [],
      candidates: Array.isArray(d.candidates) ? d.candidates : [],
    };
  } catch {
    return emptyImageAdBatchDoc();
  }
}

// Server actions hand failures back as data — see `attempt` in the action file.
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

// Images are not billed per token, so the token-based usage estimator cannot
// price them, and each model renders at its own speed and resolution. These are
// per-model facts the UI quotes before spending and the usage log records after.
export interface ImageModelProfile {
  model: string;
  costUsd: number;
  secondsPerImage: number;
  // Omitted for models that render at one fixed size and reject the parameter.
  imageSize?: string;
}

const IMAGE_MODEL_PROFILES: Record<string, Omit<ImageModelProfile, "model">> = {
  // Nano Banana Pro. Slower and dearer, but it renders display text cleanly,
  // honours the requested aspect ratio, and follows the product brief. 2K keeps
  // the output above the 1080 x 1350 export target.
  "gemini-3-pro-image": { costUsd: 0.134, secondsPerImage: 50, imageSize: "2K" },
  // Nano Banana. Cheap and quick; renders ~896 x 1152 and drifts off-brief.
  "gemini-2.5-flash-image": { costUsd: 0.039, secondsPerImage: 8 },
};

const FALLBACK_PROFILE: Omit<ImageModelProfile, "model"> = { costUsd: 0.134, secondsPerImage: 50 };

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Prices and speeds move; IMAGE_COST_USD, IMAGE_SECONDS and IMAGE_SIZE override
// the table without a deploy, and IMAGE_MODEL switches the model itself.
export function imageAdModelProfile(): ImageModelProfile {
  const model = process.env.IMAGE_MODEL?.trim() || "gemini-3-pro-image";
  const known = IMAGE_MODEL_PROFILES[model] ?? FALLBACK_PROFILE;
  const imageSize = process.env.IMAGE_SIZE?.trim() || known.imageSize;
  return {
    model,
    costUsd: positiveNumber(process.env.IMAGE_COST_USD, known.costUsd),
    secondsPerImage: positiveNumber(process.env.IMAGE_SECONDS, known.secondsPerImage) || known.secondsPerImage,
    ...(imageSize ? { imageSize } : {}),
  };
}
