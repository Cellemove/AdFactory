import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FinalizedImage } from "../image-compress";

type BrandLogos = { dark: Buffer; white: Buffer };
let logosPromise: Promise<BrandLogos> | undefined;

// Validate before spending on a render; cache the trimmed originals per process.
export function loadCellumoveLogos(): Promise<BrandLogos> {
  logosPromise ??= Promise.all([
    readFile(path.join(process.cwd(), "assets/brand/cellumove-dark.png")),
    readFile(path.join(process.cwd(), "assets/brand/cellumove-white.png")),
  ]).then(async ([dark, white]) => {
    const trim = async (bytes: Buffer) => {
      const metadata = await sharp(bytes).metadata();
      if (!metadata.hasAlpha) throw new Error("Cellumove logos must have transparent backgrounds.");
      return sharp(bytes).trim({ threshold: 1 }).png().toBuffer();
    };
    const [trimmedDark, trimmedWhite] = await Promise.all([trim(dark), trim(white)]);
    return { dark: trimmedDark, white: trimmedWhite };
  }).catch((reason: unknown) => {
    logosPromise = undefined;
    throw new Error(`Could not load the Cellumove logos from assets/brand: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  return logosPromise;
}

export function imageAdBrandingPrompt(format: string): string {
  return `BRANDING: Compose the complete ${format} ad with all headlines, CTA, faces and product details inside the artwork. Do not reserve an empty logo area. The exact Cellumove logo will be added in a separate header outside this artwork after generation. Do not draw a logo or write the brand name yourself.`;
}

// A prompt cannot guarantee empty space. Put the complete artwork and the logo
// in disjoint rectangles instead: no OCR guess, crop, or overlay over ad pixels.
// Keep export dimensions and artwork proportions; never upscale the artwork.
export async function applyCellumoveLogo(
  source: Buffer,
  format: string,
  target: { width: number; height: number } | null = null,
  logos?: BrandLogos,
): Promise<FinalizedImage> {
  const brandLogos = logos ?? await loadCellumoveLogos();
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Cannot brand an image without dimensions.");
  const useTarget = target && metadata.width >= target.width && metadata.height >= target.height;
  const width = useTarget ? target.width : metadata.width;
  const height = useTarget ? target.height : metadata.height;
  const headerHeight = Math.ceil(height * (format === "9:16" ? 0.18 : 0.08));
  const artwork = await sharp(source)
    .resize(width, height - headerHeight, { fit: "inside", withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  const logoWidth = Math.max(1, Math.round(width * 0.26));
  const logo = await sharp(brandLogos.dark).resize({ width: logoWidth }).png().toBuffer({ resolveWithObject: true });
  const left = width - Math.round(width * 0.04) - logoWidth;
  const top = format === "9:16" ? Math.round(height * 0.14) : Math.floor((headerHeight - logo.info.height) / 2);
  if (top < 0 || top + logo.info.height > headerHeight) throw new Error("Image is too small for a separate logo header.");
  const bytes = await sharp({ create: { width, height, channels: 3, background: "white" } })
    .composite([
      { input: artwork.data, left: Math.floor((width - artwork.info.width) / 2), top: headerHeight + Math.floor((height - headerHeight - artwork.info.height) / 2) },
      { input: logo.data, left, top },
    ]).png().toBuffer();
  return { bytes, width, height };
}
