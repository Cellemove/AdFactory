-- Migration 016: normalized competitor creatives imported from BrandSearch.
--
-- Research rows remain the immutable sweep snapshots rendered by /spy. This
-- table is the durable provider-level index used for dedupe, provenance,
-- evidence review, and future promotion into the scorer's GoldAd baseline.

create table if not exists "CompetitorAd" (
  id                    text primary key,
  provider              text not null default 'brandsearch',
  "externalId"          text not null,
  platform              text not null,
  "brandId"             text,
  "brandName"           text not null default '',
  "sourceUrl"           text,
  "dashboardUrl"        text,
  "mediaType"           text not null default 'image',
  "imageUrl"            text,
  "videoUrl"            text,
  copy                   text not null default '',
  status                 text,
  "startedAt"           timestamptz,
  "endedAt"             timestamptz,
  "durationSec"         numeric,
  "transcriptUrl"       text,
  "winnerEvidence"      text not null default 'observed'
                          check ("winnerEvidence" in ('observed', 'probable_winner', 'verified_winner')),
  "evidenceReasons"     jsonb not null default '[]'::jsonb,
  metrics                jsonb not null default '{}'::jsonb,
  "reviewStatus"        text not null default 'unreviewed'
                          check ("reviewStatus" in ('unreviewed', 'shortlisted', 'approved', 'rejected')),
  "rawPayload"          jsonb not null default '{}'::jsonb,
  "mediaExpiresAt"      timestamptz,
  "firstSeenAt"         timestamptz not null default now(),
  "lastSeenAt"          timestamptz not null default now(),
  "fetchedAt"           timestamptz not null default now(),
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create unique index if not exists competitorad_provider_external_key
  on "CompetitorAd" (provider, platform, "externalId");
create index if not exists competitorad_evidence_idx
  on "CompetitorAd" ("winnerEvidence", "reviewStatus", "lastSeenAt" desc);
create index if not exists competitorad_brand_idx
  on "CompetitorAd" ("brandId", platform);

