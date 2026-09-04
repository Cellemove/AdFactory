-- Reference formats can now be extracted from a reference video ("copy this
-- ad's framework") instead of only being hand-authored or seeded. Record where
-- each one came from so the picker can group them, and so a format can later be
-- re-extracted from, or deduped against, its source.
--
-- All three columns are nullable: every existing row and the current
-- upsertReferenceFormat() field set keep working untouched. A NULL sourceKind
-- means "seeded or hand-authored".

ALTER TABLE "ReferenceFormat" ADD COLUMN IF NOT EXISTS "sourceKind"  TEXT;  -- 'upload' | 'youtube' | 'url'
ALTER TABLE "ReferenceFormat" ADD COLUMN IF NOT EXISTS "sourceUrl"   TEXT;  -- NULL for uploads
ALTER TABLE "ReferenceFormat" ADD COLUMN IF NOT EXISTS "sourceLabel" TEXT;  -- human label: filename, video title, hostname
