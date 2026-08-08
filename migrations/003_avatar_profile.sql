-- Migration 003 — structured Avatar Deep Dive profile.
-- Adds a JSON-stringified `profile` column to AvatarResearch so research can
-- persist the full deep-dive structure (voice profile, buyer psychology, ranked
-- angle candidates, language mining, …) instead of only the flat 9 fields.
-- Nullable + text so legacy rows and partial profiles are fine.
-- Run once in the Supabase SQL Editor (idempotent).

ALTER TABLE "AvatarResearch" ADD COLUMN IF NOT EXISTS profile TEXT;
