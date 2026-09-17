import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { finalizeAdImage } from "./image-compress";
import { probeImage } from "./image-probe";

// Photo-like input: smooth gradients with per-pixel grain, which a truecolour PNG
// stores expensively. A flat or repeating fill would pass any size check.
async function photoLikePng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = (seed >>> 24) % 24;
      const offset = (y * width + x) * 3;
      raw[offset] = Math.min(255, Math.floor((x / width) * 200) + grain);
      raw[offset + 1] = Math.min(255, Math.floor((y / height) * 200) + grain);
      raw[offset + 2] = Math.min(255, 90 + grain);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("fits a 2K render to the exact export size and shrinks the file", async () => {
  const source = await photoLikePng(1856, 2304);
  const result = await finalizeAdImage(source, { width: 1080, height: 1350 });
  assert.ok(result);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
  assert.deepEqual(probeImage(result.bytes), { format: "png", width: 1080, height: 1350 });
  assert.ok(result.bytes.length < source.length, "compressed output should be smaller");
});

test("writes a palette PNG (the house compression setting)", async () => {
  const result = await finalizeAdImage(await photoLikePng(400, 500), null);
  assert.ok(result);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.isPalette, true);
});

test("never enlarges a render that is smaller than the target", async () => {
  const result = await finalizeAdImage(await photoLikePng(896, 1152), { width: 1080, height: 1350 });
  assert.ok(result);
  assert.equal(result.width, 896);
  assert.equal(result.height, 1152);
});

test("returns null for bytes it cannot process instead of throwing", async () => {
  assert.equal(await finalizeAdImage(Buffer.from("not an image"), { width: 1080, height: 1350 }), null);
});
