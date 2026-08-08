-- Migration 001 — Layer-1 SOP foundation (+ folds in the still-pending handoff migrations)
-- Run this once in the Supabase SQL Editor. Every statement is idempotent
-- (IF NOT EXISTS), so it is safe to run even if some of the pending migrations
-- below were already applied.

-- ─── Pending from handoff.md (run if not already applied) ────────────────────

-- 1. Static/Video categorization on winners
ALTER TABLE "WinningAd"
  ADD COLUMN IF NOT EXISTS "adType" TEXT NOT NULL DEFAULT 'static';

-- 2. Research sessions
CREATE TABLE IF NOT EXISTS "Research" (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  "angleSlug" TEXT,
  focus TEXT,
  drafts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Research_createdAt_idx" ON "Research" ("createdAt" DESC);

-- 3. Gemini usage tracking
CREATE TABLE IF NOT EXISTS "Usage" (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Usage_createdAt_idx" ON "Usage" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Usage_feature_idx" ON "Usage" (feature);

-- ─── New: Layer-1 SOP foundation ─────────────────────────────────────────────

-- Sop = a written SOP the agents read. `body` is markdown injected verbatim into
-- an agent's system prompt; `payload` holds structured (JSON) SOPs.
CREATE TABLE IF NOT EXISTS "Sop" (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,                 -- verbatim_classification | source_weighting | hook_taxonomy | ...
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload TEXT,                       -- JSON-stringified structured payload
  "roleScope" TEXT NOT NULL DEFAULT 'all',  -- strategist|copywriter|researcher|designer|compliance|all
  "marketScope" TEXT,                 -- NULL = global; else a market code
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Sop_roleScope_idx" ON "Sop" ("roleScope");
CREATE INDEX IF NOT EXISTS "Sop_type_idx" ON "Sop" (type);

-- ReferenceFormat = a SCRIPT structure (Magic Formula, Regret Arc, …). `beats`
-- is the timed skeleton the Script Generator (Module 5) fills in.
CREATE TABLE IF NOT EXISTS "ReferenceFormat" (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  beats TEXT NOT NULL DEFAULT '[]',          -- JSON: [{label,time,note}]
  "bestForAngle" TEXT,
  "optimalDurationSec" INTEGER,
  "exampleScripts" TEXT,                      -- JSON: string[]
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MarketProfile = per-market tone + claims rules (Modules 11 & 12).
CREATE TABLE IF NOT EXISTS "MarketProfile" (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- uk|es|de|cz|pl|pt|gr|se|nz|au|ca
  name TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT '',
  vocabulary TEXT,                     -- JSON: { favor:[], avoid:[] }
  "hooksThatWork" TEXT,                -- JSON: string[]
  "hooksThatFlop" TEXT,                -- JSON: string[]
  "allowedClaims" TEXT,                -- JSON: string[]
  "forbiddenClaims" TEXT,              -- JSON: string[]
  "disclaimerClaims" TEXT,             -- JSON: string[]
  "trustpilotScore" TEXT,
  "culturalNotes" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
