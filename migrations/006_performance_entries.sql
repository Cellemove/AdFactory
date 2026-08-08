-- Migration 006: ad performance (KPI) ingestion.
-- Lets the team enter real ad KPIs and link them to a WinningAd, so the Iterate
-- lane can feed "what actually happened" into Gemini. Idempotent.

create table if not exists "PerformanceEntry" (
  id           text primary key,
  "winnerId"   text,
  "adName"     text not null,
  spend        double precision not null default 0,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  ctr          double precision,
  cpa          double precision,
  roas         double precision,
  purchases    integer not null default 0,
  date         timestamptz not null default now(),
  source       text not null default 'manual',
  notes        text,
  "createdAt"  timestamptz not null default now()
);

-- If the table pre-existed (from the original schema) without winnerId, add it.
alter table "PerformanceEntry" add column if not exists "winnerId" text;

create index if not exists performanceentry_winner_idx on "PerformanceEntry" ("winnerId");
create index if not exists performanceentry_adname_idx on "PerformanceEntry" ("adName");
