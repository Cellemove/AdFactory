import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { applyCellumoveLogo, loadCellumoveLogos } from "./image-ad-branding";
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

for (const format of ["1:1", "4:5", "9:16"]) {
  for (const background of ["white", "black"]) {
    test(`${format} places a contrasting logo on ${background} without changing other pixels`, async () => {
      const target = imageAdExportSize(format);
      const source = await sharp({ create: { ...target, channels: 3, background } }).png().toBuffer();
      const result = await applyCellumoveLogo(source, format, target);
      assert.equal(result.width, target.width);
      assert.equal(result.height, target.height);
      const { data, info } = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const original = background === "white" ? 255 : 0;
      let changed = 0;
      const top = Math.round(target.height * (format === "9:16" ? 0.14 : 0.04));
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const value = data[(y * info.width + x) * info.channels]!;
          if (Math.abs(value - original) < 20) continue;
          changed += 1;
          assert.ok(x >= target.width * 0.69 && x <= target.width * 0.97, "logo must stay in reserved horizontal space");
          assert.ok(y >= top && y < top + target.width * 0.04, "logo must be cropped to lettering and respect the top safe area");
        }
      }
      assert.ok(changed > 500, "the logo must actually be visible in the exported pixels");
      const compressed = await finalizeAdImage(result.bytes, null);
      assert.ok(compressed);
      assert.equal(compressed.width, target.width);
      assert.equal(compressed.height, target.height);
    });
  }
}

test("fits a large render before branding and never enlarges a small render", async () => {
  for (const [width, height] of [[1856, 2304], [896, 1152]]) {
    const source = await sharp({ create: { width: width!, height: height!, channels: 3, background: "#eacddc" } }).png().toBuffer();
    const result = await applyCellumoveLogo(source, "4:5", imageAdExportSize("4:5"));
    assert.equal(result.width, Math.min(width!, 1080));
    assert.equal(result.height, Math.min(height!, 1350));
  }
});

test("busy backgrounds get a light backing to keep the thin lettering readable", async () => {
  const width = 1080;
  const height = 1080;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw.fill(x % 2 ? 255 : 0, (y * width + x) * 3, (y * width + x + 1) * 3);
    }
  }
  const source = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const result = await applyCellumoveLogo(source, "1:1");
  // Just above the letters, inside the backing: a previously black stripe turns light.
  const pixel = await sharp(result.bytes).extract({ left: 800, top: 38, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(pixel[0]! > 230);
});

test("invalid source fails explicitly instead of silently shipping an unbranded ad", async () => {
  await assert.rejects(applyCellumoveLogo(Buffer.from("not an image"), "4:5"));
});
