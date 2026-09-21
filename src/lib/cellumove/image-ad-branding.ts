import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
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
  const top = format === "9:16" ? 14 : 4;
  return `BRAND LOGO SPACE: Keep the top-right area from 68% to 98% of image width and ${top - 2}% to ${top + 6}% of image height clear of text, faces, and product details, with a quiet background. The exact Cellumove logo will be added there after generation. Do not draw a logo or write the brand name yourself.`;
}

function luminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

// This is local compositing, not an AI edit: keep the original lettering intact.
// Fit first so the final crop cannot cut into the logo. Never upscale the ad.
export async function applyCellumoveLogo(
  source: Buffer,
  format: string,
  target: { width: number; height: number } | null = null,
  logos?: BrandLogos,
): Promise<FinalizedImage> {
  const brandLogos = logos ?? await loadCellumoveLogos();
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Cannot brand an image without dimensions.");
  let base = sharp(source);
  if (target && metadata.width >= target.width && metadata.height >= target.height) {
    base = base.resize(target.width, target.height, { fit: "cover", position: "centre" });
  }
  const fitted = await base.png().toBuffer({ resolveWithObject: true });
  const { width, height } = fitted.info;
  const logoWidth = Math.max(1, Math.round(width * 0.26));
  const [dark, white] = await Promise.all([brandLogos.dark, brandLogos.white].map((bytes) =>
    sharp(bytes).resize({ width: logoWidth }).png().toBuffer({ resolveWithObject: true })));
  const left = width - Math.round(width * 0.04) - logoWidth;
  const top = Math.round(height * (format === "9:16" ? 0.14 : 0.04));
  const region = await sharp(fitted.data)
    .extract({ left, top, width: logoWidth, height: Math.max(dark!.info.height, white!.info.height) })
    .flatten({ background: "white" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const lightness: number[] = [];
  for (let i = 0; i < region.length; i += 3) {
    lightness.push(0.2126 * luminance(region[i]!) + 0.7152 * luminance(region[i + 1]!) + 0.0722 * luminance(region[i + 2]!));
  }
  lightness.sort((a, b) => a - b);
  // Compare contrast against the extremes, not just the average of a busy photo.
  const darkContrast = (lightness[Math.floor(lightness.length * 0.1)]! + 0.05) / 0.05;
  const whiteContrast = 1.05 / (lightness[Math.floor(lightness.length * 0.9)]! + 0.05);
  const needsBacking = Math.max(darkContrast, whiteContrast) < 3;
  const logo = needsBacking || darkContrast >= whiteContrast ? dark! : white!;
  const overlays: OverlayOptions[] = [];
  if (needsBacking) {
    const pad = Math.max(1, Math.round(width * 0.012));
    const plateWidth = logoWidth + pad * 2;
    const plateHeight = logo.info.height + pad * 2;
    overlays.push({
      input: Buffer.from(`<svg width="${plateWidth}" height="${plateHeight}"><rect width="100%" height="100%" rx="${pad}" fill="white" fill-opacity="0.94"/></svg>`),
      left: left - pad,
      top: top - pad,
    });
  }
  overlays.push({ input: logo.data, left, top });
  const bytes = await sharp(fitted.data).composite(overlays).png().toBuffer();
  return { bytes, width, height };
}
