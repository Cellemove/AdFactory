import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { applyCellumoveLogo, loadCellumoveLogos } from "./image-ad-branding";
import { canApplyImageAdLogo, IMAGE_AD_LOGO_LAYOUT_VERSION, type ImageAdCandidate } from "./image-ad-concepts";
import { finalizeAdImage } from "../image-compress";
import { imageAdExportSize } from "./image-ad-batch";

test("Canva assets trim to transparent wordmarks, preserving their proportions", async () => {
  const logos = await loadCellumoveLogos();
  for (const bytes of [logos.dark, logos.white]) {
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.hasAlpha, true);
    assert.ok(metadata.width! / metadata.height! > 8);
    assert.ok(metadata.width! / metadata.height! < 9);
  }
});

// Text across the old overlay position, CTA at the bottom, and edge markers:
// even a small crop or any logo pixels inside the artwork must fail this test.
async function fullBleedAd(width: number, height: number, background: string): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    <rect x="0" y="0" width="${width}" height="100" fill="#ffd4de"/>
    <text x="15" y="70" font-size="46" fill="black">Full width headline — KEEP EVERY WORD</text>
    <rect x="1" y="110" width="12" height="${height - 220}" fill="red"/>
    <rect x="${width - 13}" y="110" width="12" height="${height - 220}" fill="blue"/>
    <rect y="${height - 90}" width="${width}" height="90" fill="#d48191"/>
    <text x="20" y="${height - 20}" font-size="40" fill="white">Shop Now — KEEP THE CTA</text>
  </svg>`)).png().toBuffer();
}

for (const format of ["1:1", "4:5", "9:16"]) {
  for (const background of ["white", "black"]) {
    test(`${format} on ${background}: the complete resized artwork is untouched by branding`, async () => {
      const target = imageAdExportSize(format);
      const source = await fullBleedAd(target.width, target.height, background);
      const result = await applyCellumoveLogo(source, format, target);
      assert.equal(result.width, target.width);
      assert.equal(result.height, target.height);
      const headerHeight = Math.ceil(target.height * (format === "9:16" ? 0.18 : 0.08));
      const expected = await sharp(source).resize(target.width, target.height - headerHeight, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "white" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = await sharp(result.bytes).extract({
        left: Math.floor((target.width - expected.info.width) / 2),
        top: headerHeight + Math.floor((target.height - headerHeight - expected.info.height) / 2),
        width: expected.info.width,
        height: expected.info.height,
      }).removeAlpha().raw().toBuffer();
      assert.deepEqual(actual, expected.data, "no logo, backing plate, crop or stretching may alter the artwork");
      assert.ok(Math.abs(expected.info.width / expected.info.height - target.width / target.height) < 0.002);
      const header = await sharp(result.bytes).extract({ left: 0, top: 0, width: target.width, height: headerHeight })
        .removeAlpha().raw().toBuffer();
      assert.ok(header.filter((value) => value < 100).length > 500, "the logo must actually appear in its separate header");
      const compressed = await finalizeAdImage(result.bytes, null);
      assert.ok(compressed);
      assert.equal(compressed.width, target.width);
      assert.equal(compressed.height, target.height);
    });
  }
}

test("fits a large render and never enlarges a small render", async () => {
  for (const [width, height] of [[1856, 2304], [896, 1152]]) {
    const result = await applyCellumoveLogo(await fullBleedAd(width!, height!, "#eacddc"), "4:5", imageAdExportSize("4:5"));
    assert.equal(result.width, Math.min(width!, 1080));
    assert.equal(result.height, Math.min(height!, 1350));
  }
});

test("invalid source fails explicitly instead of silently shipping an unbranded ad", async () => {
  await assert.rejects(applyCellumoveLogo(Buffer.from("not an image"), "4:5"));
});

test("repair needs a clean original, and current logos cannot be added twice", () => {
  const candidate = { status: "ready", imageUrl: "/old.png" } as ImageAdCandidate;
  assert.equal(canApplyImageAdLogo(candidate), true);
  assert.equal(canApplyImageAdLogo({ ...candidate, logoAppliedAt: "2026-09-21" }), false);
  assert.equal(canApplyImageAdLogo({ ...candidate, logoAppliedAt: "2026-09-21", unbrandedImageUrl: "/clean.png" }), true);
  assert.equal(canApplyImageAdLogo({ ...candidate, logoLayoutVersion: IMAGE_AD_LOGO_LAYOUT_VERSION, unbrandedImageUrl: "/clean.png" }), false);
  assert.equal(canApplyImageAdLogo({ ...candidate, status: "generating" }), false);
});
