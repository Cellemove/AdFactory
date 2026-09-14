-- Migration 017: Corpus Miner (INGEST → MEDIA → TRANSCRIBE → EXTRACT → MINE).
--
-- Competitor ads already land in "CompetitorAd" (migration 016). This migration
-- adds everything downstream of ingestion: durable media copies, timecoded
-- two-channel transcripts (voiceover + on-screen text), the per-ad beat
-- decomposition behind an evidence gate, the mined pattern snapshots, and the
-- Gate-1 evaluation log. Every LLM stage records its prompt/taxonomy/engine
-- version so a changed number can be traced to a changed input or a changed
-- prompt. Idempotent: safe to re-run.
--
-- Table names are prefixed Ad*/Corpus* on purpose: the shared Supabase project
-- also hosts tables from a sibling application.

-- ─── Ranking + cohort tags on the durable competitor index ───────────────────
alter table "CompetitorAd" add column if not exists "winnerScore"        double precision;
alter table "CompetitorAd" add column if not exists "winnerScoreVersion" text;
alter table "CompetitorAd" add column if not exists "winnerScoreInputs"  jsonb;
alter table "CompetitorAd" add column if not exists "formatTag"          text;
alter table "CompetitorAd" add column if not exists "angleTag"           text;
alter table "CompetitorAd" add column if not exists "tagSource"          text
  check ("tagSource" is null or "tagSource" in ('manual', 'llm', 'import'));
alter table "CompetitorAd" add column if not exists "corpusIncluded"     boolean not null default true;
create index if not exists competitorad_corpus_idx
  on "CompetitorAd" ("mediaType", "corpusIncluded", "winnerScore" desc);

-- ─── MEDIA: one durable copy per ad ──────────────────────────────────────────
create table if not exists "AdMedia" (
  id               text primary key,
  "competitorAdId" text not null unique references "CompetitorAd"(id) on delete cascade,
  status           text not null default 'pending'
                     check (status in ('pending', 'downloaded', 'oversize', 'unavailable', 'expired', 'not_video', 'failed')),
  "statusReason"   text,
  "sourceUrl"      text,
  "sourceKind"     text check ("sourceKind" is null or "sourceKind" in ('video_sd_url', 'video_hd_url', 'videoUrl')),
  sha256           text,
  bytes            bigint,
  mime             text,
  "localPath"      text,
  -- BrandSearch rarely reports a duration; TRANSCRIBE fills this from the video.
  "durationSec"    double precision,
  "downloadedAt"   timestamptz,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now()
);
create index if not exists admedia_status_idx on "AdMedia" (status);
create index if not exists admedia_sha_idx    on "AdMedia" (sha256);

-- ─── TRANSCRIBE ──────────────────────────────────────────────────────────────
create table if not exists "CorpusTranscriptRun" (
  id                      text primary key,
  "runKey"                text not null unique,
  "competitorAdId"        text not null references "CompetitorAd"(id) on delete cascade,
  "mediaId"               text not null references "AdMedia"(id) on delete cascade,
  "mediaSha256"           text not null,
  model                   text not null,
  "promptVersion"         text not null,
  status                  text not null default 'running' check (status in ('running', 'complete', 'failed')),
  language                text,
  "durationSec"           double precision,
  "segmentCount"          integer not null default 0,
  -- Provider transcript (voice only) kept verbatim for the cross-check.
  "brandSearchTranscript" text,
  "crossCheck"            jsonb,
  usage                   jsonb,
  "errorSummary"          text,
  "startedAt"             timestamptz not null default now(),
  "completedAt"           timestamptz,
  "createdAt"             timestamptz not null default now()
);
create index if not exists corpustranscriptrun_ad_idx
  on "CorpusTranscriptRun" ("competitorAdId", status, "createdAt" desc);

create table if not exists "CorpusTranscriptSegment" (
  id               text primary key,
  "runId"          text not null references "CorpusTranscriptRun"(id) on delete cascade,
  "competitorAdId" text not null,
  channel          text not null check (channel in ('vo', 'ost')),
  "orderIndex"     integer not null check ("orderIndex" >= 0),
  "tStart"         double precision not null check ("tStart" >= 0),
  "tEnd"           double precision not null,
  text             text not null,
  confidence       double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  "createdAt"      timestamptz not null default now(),
  unique ("runId", channel, "orderIndex"),
  check ("tEnd" >= "tStart")
);
create index if not exists corpustranscriptsegment_ad_idx
  on "CorpusTranscriptSegment" ("competitorAdId", channel, "tStart");

-- ─── EXTRACT ─────────────────────────────────────────────────────────────────
create table if not exists "CorpusExtractRun" (
  id                       text primary key,
  "runKey"                 text not null unique,
  "competitorAdId"         text not null references "CompetitorAd"(id) on delete cascade,
  "transcriptRunId"        text not null references "CorpusTranscriptRun"(id) on delete cascade,
  "taxonomyVersion"        text not null,
  "extractorPromptVersion" text not null,
  "engineVersion"          text not null,
  model                    text not null,
  "withVideo"              boolean not null default false,
  status                   text not null default 'running'
                             check (status in ('running', 'complete', 'needs_human_review', 'failed', 'reviewed')),
  attempts                 integer not null default 0,
  -- Per-beat evidence-gate outcome of the last attempt.
  "gateReport"             jsonb,
  -- Last raw model output, kept so a quarantined ad can be reviewed by hand.
  "rawResponse"            jsonb,
  usage                    jsonb,
  "errorCode"              text,
  "errorSummary"           text,
  "reviewedByUserId"       text references "AppUser"(id),
  "reviewedAt"             timestamptz,
  "reviewNote"             text,
  "startedAt"              timestamptz not null default now(),
  "completedAt"            timestamptz,
  "createdAt"              timestamptz not null default now()
);
create index if not exists corpusextractrun_ad_idx
  on "CorpusExtractRun" ("competitorAdId", "taxonomyVersion", status, "createdAt" desc);
create index if not exists corpusextractrun_status_idx
  on "CorpusExtractRun" (status, "createdAt" desc);

-- Same shape as "GoldBeat" plus provenance. The composite FK to
-- "CopyTaxonomyCode" makes an invented code impossible to store.
create table if not exists "AdBeat" (
  id                       text primary key,
  "runId"                  text not null references "CorpusExtractRun"(id) on delete cascade,
  "competitorAdId"         text not null,
  "taxonomyVersion"        text not null,
  "orderIndex"             integer not null check ("orderIndex" >= 0),
  layer                    text not null check (layer in ('H', 'Q', 'P', 'B', 'M', 'PR', 'O', 'OTHER')),
  code                     text not null,
  "startSec"               double precision,
  "endSec"                 double precision,
  "evidenceQuote"          text not null,
  "otherExplanation"       text,
  channel                  text not null check (channel in ('vo', 'ost')),
  "matchScore"             double precision,
  "matchedSegmentId"       text references "CorpusTranscriptSegment"(id) on delete set null,
  "extractorPromptVersion" text not null,
  model                    text not null,
  "createdAt"              timestamptz not null default now(),
  unique ("runId", "orderIndex"),
  foreign key ("taxonomyVersion", code, layer) references "CopyTaxonomyCode"(version, code, layer)
);
create index if not exists adbeat_ad_idx  on "AdBeat" ("competitorAdId", "taxonomyVersion", "orderIndex");
create index if not exists adbeat_run_idx on "AdBeat" ("runId", "orderIndex");

-- ─── MINE: pattern snapshots ─────────────────────────────────────────────────
create table if not exists "CorpusPatternReport" (
  id                text primary key,
  "taxonomyVersion" text not null,
  "engineVersion"   text not null,
  cohort            text not null check (cohort in ('all', 'format', 'brand', 'angle')),
  "cohortKey"       text not null,
  "adCount"         integer not null,
  -- sha256 of the sorted (adId, extractRunId, winnerScore) tuples that fed the
  -- report: re-mining an unchanged corpus is a no-op, history is preserved.
  "inputHash"       text not null,
  report            jsonb not null,
  "createdAt"       timestamptz not null default now(),
  unique ("taxonomyVersion", "engineVersion", cohort, "cohortKey", "inputHash")
);
create index if not exists corpuspatternreport_latest_idx
  on "CorpusPatternReport" ("taxonomyVersion", "engineVersion", cohort, "cohortKey", "createdAt" desc);

-- ─── Gate 1 evaluation log ───────────────────────────────────────────────────
create table if not exists "CorpusEvalRun" (
  id                       text primary key,
  "baselineVersion"        text not null,
  "taxonomyVersion"        text not null,
  "extractorPromptVersion" text not null,
  "engineVersion"          text not null,
  model                    text not null,
  "goldAdCount"            integer not null,
  "layerAgreement"         double precision,
  "codeAgreement"          double precision,
  "orderAgreement"         double precision,
  passed                   boolean not null default false,
  "perAd"                  jsonb not null default '[]'::jsonb,
  usage                    jsonb,
  "createdAt"              timestamptz not null default now()
);
create index if not exists corpusevalrun_latest_idx
  on "CorpusEvalRun" ("taxonomyVersion", "extractorPromptVersion", model, "createdAt" desc);

-- ─── Per-ad pipeline state, computed (nothing denormalised to drift) ─────────
create or replace view "CorpusAdState" as
select
  a.id,
  a."brandName",
  a."mediaType",
  a.status                          as "adStatus",
  a."winnerScore",
  a."formatTag",
  a."angleTag",
  a."corpusIncluded",
  a."mediaExpiresAt",
  a."videoUrl" is not null          as "hasVideoUrl",
  a."transcriptUrl" is not null     as "hasBrandSearchTranscript",
  m.id                              as "mediaId",
  m.status                          as "mediaStatus",
  m."statusReason"                  as "mediaReason",
  m.sha256                          as "mediaSha256",
  m."durationSec",
  t.id                              as "transcriptRunId",
  t.status                          as "transcriptStatus",
  t."segmentCount",
  e.id                              as "extractRunId",
  e.status                          as "extractStatus",
  e."taxonomyVersion"               as "extractTaxonomyVersion",
  e."errorSummary"                  as "extractError",
  (select count(*) from "AdBeat" b where b."runId" = e.id) as "beatCount",
  case
    when a."mediaType" <> 'video' or not a."corpusIncluded" then 'skipped'
    when e.status in ('complete', 'reviewed') then 'extracted'
    when e.status = 'needs_human_review' then 'needs_review'
    when e.status = 'failed' or t.status = 'failed'
      or m.status in ('failed', 'oversize', 'unavailable', 'expired', 'not_video') then 'failed'
    when t.status = 'complete' then 'transcribed'
    when m.status = 'downloaded' then 'media'
    else 'ingested'
  end as stage
from "CompetitorAd" a
left join "AdMedia" m on m."competitorAdId" = a.id
left join lateral (
  select * from "CorpusTranscriptRun" t
  where t."competitorAdId" = a.id
  order by (t.status = 'complete') desc, t."createdAt" desc
  limit 1
) t on true
left join lateral (
  select * from "CorpusExtractRun" e
  where e."competitorAdId" = a.id and (t.id is null or e."transcriptRunId" = t.id)
  order by (e.status in ('complete', 'reviewed')) desc, e."createdAt" desc
  limit 1
) e on true;
