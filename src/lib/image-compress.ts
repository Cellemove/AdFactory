import sharp from "sharp";

// Final export step for a generated ad: fit it to the exact delivery size, then
// compress with the house PNG settings — palette mode, 256 colours, dithering on.
// On a 2K render this lands around a tenth of the original file size with no
// visible loss at ad scale.

export interface FinalizedImage {
  bytes: Buffer;
  width: number;
  height: number;
}

// Returns null when the bytes cannot be processed, so callers can keep the
// original render rather than fail a paid generation over file size.
export async function finalizeAdImage(
  source: Buffer,
  target: { width: number; height: number } | null,
): Promise<FinalizedImage | null> {
  try {
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) return null;

    let pipeline = sharp(source);
    let width = metadata.width;
    let height = metadata.height;
    // Only ever scale down. The model's aspect ratio is within a percent of the
    // target, so a centred cover crop trims a sliver rather than distorting; a
    // render smaller than the target keeps its own size instead of being blown up.
    if (target && metadata.width >= target.width && metadata.height >= target.height) {
      pipeline = pipeline.resize(target.width, target.height, { fit: "cover", position: "centre" });
      width = target.width;
      height = target.height;
    }

    const bytes = await pipeline
      .png({ palette: true, colours: 256, dither: 1, effort: 10, compressionLevel: 9 })
      .toBuffer();
    return { bytes, width, height };
  } catch (reason) {
    // Never fail a paid render over file size — but say so, because a silent
    // fallback ships 5MB truecolour PNGs that look fine until someone checks.
    console.error("[image-compress] falling back to the uncompressed render:", reason);
    return null;
  }
}
