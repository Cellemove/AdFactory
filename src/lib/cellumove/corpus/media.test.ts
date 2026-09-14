import assert from "node:assert/strict";
import test from "node:test";
import { isMediaLinkExpired, mediaFileName, pickMediaSource } from "./media";

test("SD is preferred, then HD, then the stored video URL; images yield nothing", () => {
  assert.deepEqual(pickMediaSource({ mediaType: "video", videoUrl: "https://x/hd.mp4", rawPayload: { video_sd_url: "https://x/sd.mp4", video_hd_url: "https://x/hd.mp4" } }), { url: "https://x/sd.mp4", kind: "video_sd_url" });
  assert.deepEqual(pickMediaSource({ mediaType: "video", videoUrl: "https://x/hd.mp4", rawPayload: { video_hd_url: "https://x/hd.mp4" } }), { url: "https://x/hd.mp4", kind: "video_hd_url" });
  assert.deepEqual(pickMediaSource({ mediaType: "video", videoUrl: "https://x/v.mp4", rawPayload: {} }), { url: "https://x/v.mp4", kind: "videoUrl" });
  assert.equal(pickMediaSource({ mediaType: "video", videoUrl: null, rawPayload: { video_sd_url: "  " } }), null);
  assert.equal(pickMediaSource({ mediaType: "image", videoUrl: "https://x/v.mp4", rawPayload: {} }), null);
});

test("expiry compares against now and tolerates missing values", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(isMediaLinkExpired({ mediaExpiresAt: "2026-09-13T07:23:44Z" }, now), false);
  assert.equal(isMediaLinkExpired({ mediaExpiresAt: "2026-09-09T07:23:44Z" }, now), true);
  assert.equal(isMediaLinkExpired({ mediaExpiresAt: null }, now), false);
});

test("file names derive from the hash and container", () => {
  assert.equal(mediaFileName("abc", "video/mp4"), "abc.mp4");
  assert.equal(mediaFileName("abc", "video/quicktime"), "abc.mov");
  assert.equal(mediaFileName("abc", "application/octet-stream"), "abc.bin");
});
