import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyVerbatimCategory,
  isUsefulCustomerVerbatim,
  verifiedCandidatesFromYouTube,
} from "./verified-verbatims";

test("quality gate accepts specific first-person experience and rejects generic reactions", () => {
  assert.equal(isUsefulCustomerVerbatim("I'm 45 and my legs feel painfully heavy after I stand at work all day."), true);
  assert.equal(isUsefulCustomerVerbatim("Great video, thank you so much!"), false);
  assert.equal(isUsefulCustomerVerbatim("Cellulite is a common skin condition."), false);
  assert.equal(isUsefulCustomerVerbatim("I checked my hormones through Vital Test Hub and it might help someone with menopause symptoms."), false);
});

test("category classifier identifies pain, desire, and objection language", () => {
  assert.equal(classifyVerbatimCategory("My legs ache and feel swollen every night."), "primary_pain");
  assert.equal(classifyVerbatimCategory("I want to feel confident enough to wear shorts again."), "desire");
  assert.equal(classifyVerbatimCategory("I've tried everything and nothing worked, so I'm skeptical."), "objection");
});

test("direct YouTube comments receive exact deep links and verified provenance", () => {
  const rows = verifiedCandidatesFromYouTube({
    angleSlug: "heavy-legs",
    threads: [{
      videoId: "video123",
      url: "https://www.youtube.com/watch?v=video123",
      title: "Heavy legs",
      channel: "Example",
      comments: [{
        id: "comment456",
        text: "I'm on my feet all day and my legs feel painfully heavy by dinner time.",
        likes: 42,
        author: "Customer",
        publishedAt: "2026-01-01T00:00:00Z",
      }],
    }],
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.researchId, "verified:youtube-data-api-v3");
  assert.match(row.sourceUrl, /[?&]lc=comment456/);
});
