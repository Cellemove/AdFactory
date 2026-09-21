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

// Delivery size per format. Renders are fitted to exactly this before saving.
const IMAGE_AD_EXPORT_SIZES: Record<string, { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

export function imageAdExportSize(format: string): { width: number; height: number } {
  return IMAGE_AD_EXPORT_SIZES[format] ?? IMAGE_AD_EXPORT_SIZES[DEFAULT_IMAGE_AD_FORMAT]!;
}

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

// Image output has separate token rates from text. These per-image estimates
// cover image output only; input and reasoning may add to the provider bill.
// The UI quotes them before spending and the usage log records them after.
export interface ImageModelProfile {
  model: string;
  costUsd: number;
  secondsPerImage: number;
  // Omitted for models that render at one fixed size and reject the parameter.
  imageSize?: string;
}

const IMAGE_MODEL_PROFILES: Record<string, Omit<ImageModelProfile, "model">> = {
  // Nano Banana 2. Default to 2K so renders stay above the delivery size.
  // Keep the conservative 50s planning estimate until measured on our workload.
  "gemini-3.1-flash-image": { costUsd: 0.101, secondsPerImage: 50, imageSize: "2K" },
  // Nano Banana Pro. Slower and dearer, but it renders display text cleanly,
  // honours the requested aspect ratio, and follows the product brief. 2K keeps
  // the output above the 1080 x 1350 export target.
  "gemini-3-pro-image": { costUsd: 0.134, secondsPerImage: 50, imageSize: "2K" },
  // Nano Banana. Cheap and quick; renders ~896 x 1152 and drifts off-brief.
  "gemini-2.5-flash-image": { costUsd: 0.039, secondsPerImage: 8 },
};

const FALLBACK_PROFILE: Omit<ImageModelProfile, "model"> = { costUsd: 0.134, secondsPerImage: 50 };

// Standard global-endpoint image-output estimates, USD (Google Cloud pricing).
const IMAGE_SIZE_COSTS: Record<string, Record<string, number>> = {
  "gemini-3.1-flash-image": { "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.15 },
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Prices and speeds move; IMAGE_COST_USD, IMAGE_SECONDS and IMAGE_SIZE override
// the table without a deploy, and IMAGE_MODEL switches the model itself.
export function imageAdModelProfile(): ImageModelProfile {
  const model = process.env.IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";
  const known = IMAGE_MODEL_PROFILES[model] ?? FALLBACK_PROFILE;
  const imageSize = process.env.IMAGE_SIZE?.trim() || known.imageSize;
  const costUsd = (imageSize ? IMAGE_SIZE_COSTS[model]?.[imageSize] : undefined) ?? known.costUsd;
  return {
    model,
    costUsd: positiveNumber(process.env.IMAGE_COST_USD, costUsd),
    secondsPerImage: positiveNumber(process.env.IMAGE_SECONDS, known.secondsPerImage) || known.secondsPerImage,
    ...(imageSize ? { imageSize } : {}),
  };
}
