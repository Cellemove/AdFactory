-- Migration 008: B-roll intelligence — suggestion/usage counting + content analysis.
-- The client wants to (1) count how often each clip gets suggested so we avoid
-- over-using the same footage, (2) count actual use in shipped ads, and (3) know
-- what's IN each clip (Gemini watches it) so suggestions match content, not
-- filenames. Idempotent.

alter table "BrollClip" add column if not exists "aiDescription"   text;
alter table "BrollClip" add column if not exists tags              text;
alter table "BrollClip" add column if not exists "analyzedAt"      timestamptz;
alter table "BrollClip" add column if not exists "timesSuggested"  integer not null default 0;
alter table "BrollClip" add column if not exists "lastSuggestedAt" timestamptz;
alter table "BrollClip" add column if not exists "timesUsed"       integer not null default 0;
alter table "BrollClip" add column if not exists "lastUsedAt"      timestamptz;

-- Audit log: one row per (clip, pipeline output) detection, so counts stay
-- explainable ("suggested in run X on date Y") and per-ad usage can be traced.
create table if not exists "BrollSuggestion" (
  id          text primary key,
  "clipId"    text not null references "BrollClip"(id) on delete cascade,
  "clipName"  text not null,
  source      text not null,          -- 'designer' | 'creative_briefs'
  "refId"     text,                   -- Research row id of the run that suggested it
  "createdAt" timestamptz not null default now()
);

create index if not exists brollsuggestion_clip_idx on "BrollSuggestion" ("clipId");
create index if not exists brollsuggestion_ref_idx  on "BrollSuggestion" ("refId");
create index if not exists brollclip_suggested_idx  on "BrollClip" ("timesSuggested");
create index if not exists brollclip_analyzed_idx   on "BrollClip" ("analyzedAt");
