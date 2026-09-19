// Minimal image header reader: pixel dimensions without a native decoder.
// The project has no `sharp`, and we only need width/height plus proof that the
// bytes really are the image they claim to be — a header we can parse end to end
// is that proof. Anything we cannot parse is rejected by the callers rather than
// silently accepted.

export interface ImageProbe {
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
}

export function probeImage(bytes: Buffer): ImageProbe | null {
  return probePng(bytes) ?? probeJpeg(bytes) ?? probeWebp(bytes);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function probePng(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // IHDR must be the first chunk: [length][type][width][height]...
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { format: "png", width, height } : null;
}

// Start-of-frame markers carry the dimensions. Everything else is skipped by its
// own segment length. DHT/DRI/APPn come first in most files.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function probeJpeg(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // fill byte or padding — resynchronize on the next marker
      continue;
    }
    const marker = bytes[offset + 1]!;
    // Standalone markers carry no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan start: no SOF found
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { format: "jpeg", width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function probeWebp(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 30) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("ascii", 12, 16);

  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, 3-byte sync code, then 14-bit dimensions.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { format: "webp", width, height } : null;
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b0 = bytes[21]!, b1 = bytes[22]!, b2 = bytes[23]!, b3 = bytes[24]!;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { format: "webp", width, height };
  }
  if (chunk === "VP8X") {
    // Extended: 24-bit canvas dimensions, stored minus one.
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { format: "webp", width, height };
  }
  return null;
}
