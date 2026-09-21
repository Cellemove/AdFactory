-- BrandSearch research is an immutable reference snapshot, never a Teardown record.
create table if not exists "AdResearchSnapshot" (
  id text primary key, "competitorAdId" text not null references "CompetitorAd"(id),
  "schemaVersion" text not null, "sourceHash" text not null, snapshot jsonb not null,
  "rawTranscript" jsonb, "rawAnalysis" jsonb, "createdAt" timestamptz not null default now(),
  unique ("competitorAdId", "schemaVersion", "sourceHash")
);
create table if not exists "AdResearchJob" (
  "competitorAdId" text primary key references "CompetitorAd"(id),
  status text not null default 'pending' check (status in ('pending','running','ready','deferred','failed')),
  "claimToken" text, "leaseUntil" timestamptz, "nextAttemptAt" timestamptz,
  "snapshotId" text references "AdResearchSnapshot"(id), "errorSummary" text,
  "updatedAt" timestamptz not null default now()
);
create table if not exists "BrandSearchReservation" (
  scope text not null check (scope in ('daily_research','transcript')),
  day date not null, "competitorAdId" text not null references "CompetitorAd"(id),
  "createdAt" timestamptz not null default now(), primary key (scope, day, "competitorAdId")
);
-- A request remains uncertain after a crash/timeout. GET reconciliation is safe;
-- automatically sending another POST is not. Known failed requests may retry next day.
create table if not exists "BrandSearchTranscriptRequest" (
  "competitorAdId" text primary key references "CompetitorAd"(id),
  status text not null check (status in ('uncertain','succeeded','failed')),
  "requestedAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create or replace function claim_ad_research(ad_id text, token text, refresh boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  insert into "AdResearchJob" ("competitorAdId") values (ad_id) on conflict do nothing;
  update "AdResearchJob" set status='running', "claimToken"=token, "leaseUntil"=now()+interval '10 minutes', "updatedAt"=now()
  where "competitorAdId"=ad_id
    and ("leaseUntil" is null or "leaseUntil" < now())
    and (refresh or status <> 'ready')
    and (refresh or "nextAttemptAt" is null or "nextAttemptAt" <= now())
  returning "competitorAdId" into claimed;
  return claimed is not null;
end $$;

create or replace function reserve_brandsearch_budget(ad_id text, budget_scope text, cap integer default 10)
returns boolean language plpgsql security definer set search_path = public as $$
declare utc_day date := (now() at time zone 'UTC')::date; request_row "BrandSearchTranscriptRequest"%rowtype;
begin
  if budget_scope not in ('daily_research','transcript') then raise exception 'Invalid budget scope'; end if;
  perform pg_advisory_xact_lock(hashtext('brandsearch-budget-' || budget_scope));
  if budget_scope='transcript' then
    select * into request_row from "BrandSearchTranscriptRequest" where "competitorAdId"=ad_id;
    if found and (request_row.status <> 'failed' or (request_row."requestedAt" at time zone 'UTC')::date >= utc_day) then return false; end if;
  end if;
  if exists (select 1 from "BrandSearchReservation" where scope=budget_scope and day=utc_day and "competitorAdId"=ad_id) then return false; end if;
  if (select count(*) from "BrandSearchReservation" where scope=budget_scope and day=utc_day) >= greatest(0,least(10,cap)) then return false; end if;
  insert into "BrandSearchReservation" (scope,day,"competitorAdId") values (budget_scope,utc_day,ad_id);
  if budget_scope='transcript' then
    insert into "BrandSearchTranscriptRequest" ("competitorAdId",status) values (ad_id,'uncertain')
    on conflict ("competitorAdId") do update set status='uncertain', "requestedAt"=now(), "updatedAt"=now();
  end if;
  return true;
end $$;

revoke all on function claim_ad_research(text,text,boolean) from public, anon, authenticated;
revoke all on function reserve_brandsearch_budget(text,text,integer) from public, anon, authenticated;
grant execute on function claim_ad_research(text,text,boolean) to service_role;
grant execute on function reserve_brandsearch_budget(text,text,integer) to service_role;
alter table "AdResearchSnapshot" enable row level security;
alter table "AdResearchJob" enable row level security;
alter table "BrandSearchReservation" enable row level security;
alter table "BrandSearchTranscriptRequest" enable row level security;

alter table "CorpusTranscriptRun" alter column "mediaId" drop not null;
alter table "CorpusTranscriptRun" alter column "mediaSha256" drop not null;
alter table "CorpusTranscriptRun" add column if not exists source text not null default 'video_model';
alter table "CorpusTranscriptRun" add column if not exists "sourceHash" text;
alter table "CorpusTranscriptRun" add column if not exists coverage jsonb not null default '{"speech":"unknown","onScreenText":"unknown","visuals":"unknown"}';
alter table "CorpusTranscriptRun" add column if not exists "researchSnapshotId" text references "AdResearchSnapshot"(id);
alter table "CorpusTranscriptRun" drop constraint if exists corpus_transcript_source_media;
alter table "CorpusTranscriptRun" add constraint corpus_transcript_source_media check (
  (source='video_model' and "mediaId" is not null and "mediaSha256" is not null)
  or (source='brandsearch' and "sourceHash" is not null and "researchSnapshotId" is not null)
);
alter table "CorpusExtractRun" add column if not exists "researchMode" text not null default 'full_video' check ("researchMode" in ('speech_only','full_video'));
alter table "CorpusExtractRun" add column if not exists "conceptTag" text;
alter table "ScriptProject" add column if not exists "researchSnapshotId" text references "AdResearchSnapshot"(id);
alter table "ScriptProject" drop constraint if exists script_single_competitor_source;
alter table "ScriptProject" add constraint script_single_competitor_source check ("researchSnapshotId" is null or "teardownRecordId" is null);

-- Only infer historical coverage where the prompt version states the channels.
update "CorpusTranscriptRun" set "sourceHash"="mediaSha256",
  coverage=case when "promptVersion"='corpus-transcribe-v2'
    then '{"speech":"assessed","onScreenText":"assessed","visuals":"assessed"}'::jsonb
    else coverage end where source='video_model' and "sourceHash" is null;

create index if not exists adresearch_job_due on "AdResearchJob" (status,"nextAttemptAt");
create index if not exists adresearch_snapshot_ad on "AdResearchSnapshot" ("competitorAdId","createdAt" desc);
notify pgrst, 'reload schema';
