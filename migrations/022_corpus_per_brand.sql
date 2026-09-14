-- Migration 022: the corpus is a set of per-brand picks that coexist.
--
-- "Collect winning ads" now runs for one Spectre competitor at a time and
-- replaces only that brand's slice (winners.server.ts scopes the swap by
-- "brandName"), so collecting brand B no longer evicts brand A. Two changes
-- support that: an index matching the new per-brand access path, and
-- "winnerPick" on the state view so a page can show when a brand was last
-- collected, and an ad's rank within its brand, without a second query.
-- Idempotent: safe to re-run.

create index if not exists competitorad_corpus_brand_idx
  on "CompetitorAd" ("brandName", "corpusIncluded", "winnerScore" desc);

-- Same definition as migration 017 with "winnerPick" appended last:
-- "create or replace view" may add columns at the end, never reorder them.
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
  end as stage,
  a."winnerPick"
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
