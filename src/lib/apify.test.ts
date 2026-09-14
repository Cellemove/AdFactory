import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClassification,
  commentFingerprint,
  gateComments,
  isPlatformNoise,
  normalizeApifyRedditComments,
  normalizeApifyRedditPosts,
  normalizeFacebookComments,
  normalizeTiktokComments,
  normalizeTiktokVideos,
  rankRedditPosts,
  rankTiktokVideos,
  type RawComment,
} from "./apify";

// A comment that passes the standing quality gate (first-person + niche term,
// 8+ words, 35+ chars).
const GOOD_TEXT =
  "I stopped wearing shorts because my legs are so swollen by the end of every day and I hate it";

function comment(text: string, overrides: Partial<RawComment> = {}): RawComment {
  return {
    platform: "tiktok",
    externalId: overrides.externalId ?? `c-${Math.abs(hash(text))}`,
    parentId: "v1",
    text,
    author: "user",
    publishedAt: null,
    engagement: 3,
    sourceUrl: "https://example.com",
    ...overrides,
  };
}
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

test("isPlatformNoise kills laughter, emoji, bait, mentions, praise — keeps real pain", () => {
  assert.ok(isPlatformNoise("hahahaha 😂😂😂"));
  assert.ok(isPlatformNoise("LOLLL"));
  assert.ok(isPlatformNoise("😍😍🔥🔥🔥"));
  assert.ok(isPlatformNoise("first!"));
  assert.ok(isPlatformNoise("who's here in 2026"));
  assert.ok(isPlatformNoise("@bestie look at this"));
  assert.ok(isPlatformNoise("love your videos ❤️"));
  assert.ok(!isPlatformNoise(GOOD_TEXT));
});

test("laughter noise detection stays linear on long adversarial input", () => {
  assert.ok(isPlatformNoise("ha".repeat(5_000)));
  assert.ok(!isPlatformNoise(`${"ha".repeat(5_000)}x`));
});

test("gateComments keeps quality first-person comments, kills noise and in-batch dupes", () => {
  const batch = [
    comment(GOOD_TEXT),
    comment("hahaha so true 😂"),
    comment("nice video"),
    comment(GOOD_TEXT, { externalId: "dupe" }), // in-batch duplicate text
    comment("My knees ache after standing all day at work and I have tried everything the doctor suggested"),
  ];
  const { kept, killed } = gateComments(batch);
  assert.equal(kept.length, 2);
  assert.equal(killed, 3);
});

test("gateComments lets non-English first-person comments through to the AI stage", () => {
  const batch = [
    // Portuguese own-experience — English niche regex can't see it, but the
    // first-person marker + length floors let the LLM stage judge it.
    comment("Eu também e adoro, sinto uma leveza ao andar e não sinto o cansaço das pernas como sempre senti. Obrigada"),
    comment("Eu gosto imenso"), // too short — still dies at the floors
  ];
  const { kept } = gateComments(batch);
  assert.equal(kept.length, 1);
});

test("rankRedditPosts orders by score+2*comments, floors at 5 comments, caps", () => {
  const posts = [
    { id: "a", score: 10, numComments: 2 },   // under floor
    { id: "b", score: 5, numComments: 50 },
    { id: "c", score: 200, numComments: 6 },
    { id: "d", score: 1, numComments: 8 },
  ];
  const ranked = rankRedditPosts(posts, 2);
  assert.deepEqual(ranked.map((p) => p.id), ["c", "b"]);
});

test("rankTiktokVideos floors at 10 comments and sorts by plays+10*likes", () => {
  const vids = [
    { id: "low", url: "u", plays: 9999, likes: 999, commentCount: 3, language: null },
    { id: "big", url: "u", plays: 100000, likes: 5000, commentCount: 40, language: "en" },
    { id: "mid", url: "u", plays: 50000, likes: 100, commentCount: 12, language: "en" },
  ];
  assert.deepEqual(rankTiktokVideos(vids, 5).map((v) => v.id), ["big", "mid"]);
});

test("reddit normalizers split posts and comments, tolerate malformed items", () => {
  const items = [
    { dataType: "post", parsedId: "p1", url: "https://reddit.com/p1", title: "T", upVotes: 12, numberOfComments: 9 },
    { dataType: "comment", parsedId: "c1", postId: "p1", body: GOOD_TEXT, username: "u", upVotes: 4, url: "https://reddit.com/p1/c1" },
    { garbage: true },
    42,
  ];
  const posts = normalizeApifyRedditPosts(items);
  const comments = normalizeApifyRedditComments(items);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.numComments, 9);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.parentId, "p1");
  assert.equal(comments[0]!.engagement, 4);
});

test("facebook normalizer maps ids, likes, dates; skips textless items", () => {
  const items = [
    { id: "f1", text: GOOD_TEXT, likesCount: "7", date: "2026-01-01", commentUrl: "https://fb.com/c1", profileName: "A", postId: "post9" },
    { id: "f2", text: "" },
  ];
  const out = normalizeFacebookComments(items, "https://facebook.com/post");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.engagement, 7);
  assert.equal(out[0]!.parentId, "post9");
});

test("tiktok normalizers map videos and comments", () => {
  const vids = normalizeTiktokVideos([
    { id: "v1", webVideoUrl: "https://tiktok.com/v1", playCount: 10, diggCount: 2, commentCount: 30, textLanguage: "en" },
    { id: "v2" }, // no url → dropped
  ]);
  assert.equal(vids.length, 1);
  const cs = normalizeTiktokComments(
    [{ cid: "c1", text: GOOD_TEXT, diggCount: 5, uniqueId: "u", createTimeISO: "2026-01-01T00:00:00Z" }],
    "v1",
    "https://tiktok.com/v1",
  );
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.parentId, "v1");
});

test("commentFingerprint is stable and platform-distinct", () => {
  const a = commentFingerprint({ platform: "reddit", parentId: "p", externalId: "c" }, "text");
  const b = commentFingerprint({ platform: "reddit", parentId: "p", externalId: "c" }, "text");
  const c = commentFingerprint({ platform: "tiktok", parentId: "p", externalId: "c" }, "text");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("applyClassification filters, normalizes categories, ignores bad indexes; null on garbage", () => {
  const batch = [comment(GOOD_TEXT), comment("My varicose veins hurt so much after my second pregnancy and nothing has helped me yet")];
  const applied = applyClassification(batch, {
    results: [
      { i: 0, keep: true, category: "Primary Pain" },
      { i: 1, keep: false },
      { i: 99, keep: true, category: "desire" },
    ],
  });
  assert.ok(applied);
  assert.equal(applied.kept.length, 1);
  assert.equal(applied.kept[0]!.category, "primary_pain");
  assert.equal(applied.killed, 1);

  assert.equal(applyClassification(batch, { nope: true }), null);
  assert.equal(applyClassification(batch, "prose"), null);
});
