-- Migration 002 — Module 1: the Verbatim corpus.
-- Raw customer voice, captured + classified + engagement-weighted, queryable.
-- Run once in the Supabase SQL Editor (idempotent).

CREATE TABLE IF NOT EXISTS "Verbatim" (
  id TEXT PRIMARY KEY,
  "angleSlug" TEXT,                          -- angle this verbatim belongs to (nullable)
  "subAvatarId" TEXT,                        -- optional: attached to a specific sub-avatar
  category TEXT NOT NULL,                     -- taxonomy slug (primary_pain, desire, objection, …)
  text TEXT NOT NULL,                         -- the quote, in the person's own words
  "sourceType" TEXT NOT NULL,                -- reddit_thread | reddit_comment | youtube_comment | tiktok_comment | quora | amazon_review | trustpilot | forum | other
  "sourceUrl" TEXT,
  "engagementScore" INTEGER NOT NULL DEFAULT 0,   -- likes / upvotes / replies
  "sourceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,  -- source-rank × engagement factor
  market TEXT,                               -- optional market code
  "researchId" TEXT,                         -- optional: the mining session that produced it
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Verbatim_angleSlug_idx" ON "Verbatim" ("angleSlug");
CREATE INDEX IF NOT EXISTS "Verbatim_subAvatarId_idx" ON "Verbatim" ("subAvatarId");
CREATE INDEX IF NOT EXISTS "Verbatim_category_idx" ON "Verbatim" (category);
CREATE INDEX IF NOT EXISTS "Verbatim_sourceWeight_idx" ON "Verbatim" ("sourceWeight" DESC);
