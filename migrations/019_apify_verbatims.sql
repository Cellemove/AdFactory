-- Migration 019: Apify verbatim ingestion (Reddit / Meta / TikTok comments).
-- 1) Provenance + hard dedupe on Verbatim. Nullable, so legacy rows are
--    untouched; the unique index allows NULLs, so only fingerprinted rows are
--    constrained. Plain (non-partial) unique index on purpose: PostgREST
--    upsert(onConflict: "sourceFingerprint") can only infer non-partial indexes.
-- 2) VerbatimScrapeTarget: one row per post/video whose comments we ever paid
--    to fetch, so a re-run never re-pays for the same target. Idempotent.

alter table "Verbatim" add column if not exists "sourceFingerprint" text;
alter table "Verbatim" add column if not exists "sourceAuthor" text;
alter table "Verbatim" add column if not exists "sourcePublishedAt" timestamptz;

create unique index if not exists verbatim_source_fingerprint_key
  on "Verbatim" ("sourceFingerprint");

create table if not exists "VerbatimScrapeTarget" (
  id             text primary key,
  platform       text not null check (platform in ('reddit','meta','tiktok')),
  "externalId"   text not null,   -- reddit post id / fb post id / tiktok video id
  url            text not null,
  "angleSlug"    text,
  status         text not null default 'scraped' check (status in ('scraped','failed')),
  "commentCount" integer not null default 0,   -- comments fetched (billed)
  "keptCount"    integer not null default 0,   -- comments that survived the funnel
  "costUsd"      double precision,
  "scrapedAt"    timestamptz not null default now(),
  unique (platform, "externalId")
);

create index if not exists verbatimscrapetarget_platform_idx
  on "VerbatimScrapeTarget" (platform, "scrapedAt" desc);
