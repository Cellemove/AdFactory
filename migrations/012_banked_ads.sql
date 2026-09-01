-- Migration 012: Idea bank / swipe file for kept competitor ads.
--
-- Spy sweeps are ephemeral: each one writes a Research row (type "competitor_spy")
-- holding a JSON array of creatives, and the only curation available is REMOVING
-- entries from that blob. There was no way to KEEP an ad — anything worth
-- remembering was stranded inside whichever sweep happened to surface it.
--
-- This table is the durable, cross-sweep library: the ads a strategist chose to
-- keep, with their own note and a workflow status. Rows outlive the sweep they
-- came from (sweepId is provenance only, deliberately not a foreign key, so
-- pruning old Research rows never deletes banked ideas). Idempotent.

create table if not exists "BankedAd" (
  id            text primary key,
  brand         text not null default '',
  -- The ad's hook / headline / opening copy line — SpyAd.caption at save time.
  hook          text not null default '',
  "imageUrl"    text,
  platform      text,
  -- Where the creative lives. Also the dedupe key: saving the same ad twice
  -- updates the existing row rather than creating a duplicate.
  "sourceUrl"   text not null,
  "mediaType"   text not null default 'image',
  -- The strategist's own annotation — why this was worth keeping.
  note          text,
  -- new | shortlisted | used | archived
  status        text not null default 'new',
  -- Provenance: the Research row this was saved from, and who saved it.
  "sweepId"     text,
  "savedBy"     text,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- One row per creative. Makes "Save to bank" idempotent via upsert.
create unique index if not exists bankedad_sourceurl_key on "BankedAd" ("sourceUrl");

-- The page lists newest-first and filters by status.
create index if not exists bankedad_created_idx on "BankedAd" ("createdAt" desc);
create index if not exists bankedad_status_idx on "BankedAd" (status);
