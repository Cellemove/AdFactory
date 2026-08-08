-- Migration 004 — Editor claims + strategist reviews.
-- An Editor claims a completed pipeline run (the creative package produced for
-- them), optionally links their delivered work, and reads the review a Creative
-- Strategist leaves on it. Run once in the Supabase SQL Editor (idempotent).

CREATE TABLE IF NOT EXISTS "EditorClaim" (
  id TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL,                              -- Research.id of the pipeline run
  label TEXT NOT NULL,                                -- avatar / angle label for display
  "claimedByEmail" TEXT NOT NULL,                     -- the editor who claimed it
  "claimedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deliveryUrl" TEXT,                                 -- editor's delivered work (link)
  "reviewNote" TEXT,                                  -- strategist's review
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',     -- pending | changes_requested | approved
  "reviewedByEmail" TEXT,                             -- strategist who reviewed
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "EditorClaim_runId_idx" ON "EditorClaim" ("runId");
CREATE INDEX IF NOT EXISTS "EditorClaim_claimedByEmail_idx" ON "EditorClaim" ("claimedByEmail");
