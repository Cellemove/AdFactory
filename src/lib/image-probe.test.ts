import assert from "node:assert/strict";
import test from "node:test";
import { probeImage } from "./image-probe";

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

// FFD8 + a JFIF APP0 segment that must be skipped + SOF0 carrying the size.
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(4 + 14);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function webpExtended(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function webpLossy(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer[23] = 0x9d;
  buffer[24] = 0x01;
  buffer[25] = 0x2a;
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

test("reads png dimensions", () => {
  assert.deepEqual(probeImage(png(1080, 1350)), { format: "png", width: 1080, height: 1350 });
});

test("reads jpeg dimensions past a leading app segment", () => {
  assert.deepEqual(probeImage(jpeg(1200, 628)), { format: "jpeg", width: 1200, height: 628 });
});

test("reads both webp layouts", () => {
  assert.deepEqual(probeImage(webpExtended(1080, 1080)), { format: "webp", width: 1080, height: 1080 });
  assert.deepEqual(probeImage(webpLossy(640, 800)), { format: "webp", width: 640, height: 800 });
});

test("rejects bytes it cannot parse", () => {
  assert.equal(probeImage(Buffer.from("not an image at all, just text")), null);
  assert.equal(probeImage(Buffer.alloc(0)), null);
  // Truncated PNG: signature present, IHDR missing.
  assert.equal(probeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  // JPEG that ends before any start-of-frame marker.
  assert.equal(probeImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});
