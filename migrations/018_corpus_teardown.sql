-- Migration 018: Teardown workbooks for corpus winners.
--
-- The top-ranked competitor ads are sent to the Teardown service, which runs
-- its 14-part "winning ad deconstruction" workbook over the video and returns
-- it parsed into labelled fields. This is a qualitative reading layer next to
-- the coded beats, not an input to MINE: the workbook is open vocabulary with
-- no evidence gate, so it never feeds the pattern statistics.
--
-- One row per ad; a forced re-run points the row at a new Teardown record.
-- Teardown keeps its own copy (and its Google Sheets row); this is the local
-- mirror the miner pages read. Idempotent: safe to re-run.

create table if not exists "AdTeardown" (
  id               text primary key,
  "competitorAdId" text not null unique references "CompetitorAd"(id) on delete cascade,
  -- Teardown's record id (uuid), used for polling and retries.
  "teardownId"     text not null,
  status           text not null default 'queued'
                     check (status in ('queued', 'processing', 'completed', 'failed')),
  "sourceKind"     text not null
                     check ("sourceKind" in ('video_sd_url', 'video_hd_url', 'videoUrl', 'local_file')),
  "sourceUrl"      text,
  "mediaSha256"    text,
  -- Rank at submission time: which cut of "winners" this ad was sent under.
  "winnerScore"    double precision,
  "winnerScoreVersion" text,
  workbook         jsonb,
  "rawOutput"      text,
  "sheetRowLink"   text,
  "promptTokens"   integer,
  "outputTokens"   integer,
  "errorCode"      text,
  "errorMessage"   text,
  "submittedAt"    timestamptz not null default now(),
  "completedAt"    timestamptz,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now()
);
create index if not exists adteardown_status_idx on "AdTeardown" (status, "submittedAt" desc);
