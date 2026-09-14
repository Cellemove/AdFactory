-- Migration 023: visual direction in transcripts, and the per-brand playbook.
--
-- 1. Transcripts gain a third channel, "vis": one line per shot describing
--    what is on screen and the editing cue, timecoded like the words. The
--    strategist's script board is a four-column table (time, visual, audio,
--    text) and the miner only captured the words. Beats still quote "vo" or
--    "ost" only; "vis" is context for the extractor and material for the
--    playbook, never evidence.
-- 2. "CorpusBrandPlaybook" holds the mined playbook for one competitor — its
--    spine, hooks, formats and concepts, and copywriting rules, each with real
--    quotes. Same versioning and no-op discipline as "CorpusPatternReport".
-- Idempotent: safe to re-run.

alter table "CorpusTranscriptSegment" drop constraint if exists "CorpusTranscriptSegment_channel_check";
alter table "CorpusTranscriptSegment"
  add constraint "CorpusTranscriptSegment_channel_check" check (channel in ('vo', 'ost', 'vis'));

create table if not exists "CorpusBrandPlaybook" (
  id                text primary key,
  brand             text not null,
  "taxonomyVersion" text not null,
  "engineVersion"   text not null,
  "adCount"         integer not null,
  -- sha256 of the (adId, extractRunId, winnerScore) tuples that fed it: an
  -- unchanged corpus is a no-op, history is preserved.
  "inputHash"       text not null,
  playbook          jsonb not null,
  "createdAt"       timestamptz not null default now(),
  unique (brand, "taxonomyVersion", "engineVersion", "inputHash")
);
create index if not exists corpusbrandplaybook_latest_idx
  on "CorpusBrandPlaybook" (brand, "taxonomyVersion", "engineVersion", "createdAt" desc);
