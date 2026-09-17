create table if not exists public."ReferenceAnalysis" (
  id uuid primary key,
  "createdByUserId" text not null references public."AppUser"(id),
  source jsonb not null,
  "nameOverride" text not null default '',
  "teardownJobId" uuid not null unique,
  status text not null default 'uploading',
  stage text not null default 'validating',
  version text not null default 'reference_deep_dive_v1',
  result jsonb,
  error text,
  "referenceFormatId" text references public."ReferenceFormat"(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
alter table public."ReferenceAnalysis" enable row level security;
revoke all on public."ReferenceAnalysis" from anon, authenticated;
grant all on public."ReferenceAnalysis" to service_role;
alter table public."ReferenceFormat" add column if not exists "referenceAnalysisId" uuid references public."ReferenceAnalysis"(id);
alter table public."ReferenceFormat" add column if not exists strategy jsonb;
create unique index if not exists reference_format_analysis_unique on public."ReferenceFormat"("referenceAnalysisId") where "referenceAnalysisId" is not null;
create index if not exists reference_analysis_creator_date on public."ReferenceAnalysis"("createdByUserId", "createdAt" desc);

create or replace function public.save_reference_framework(analysis_id uuid, actor_id text, draft jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare analysis public."ReferenceAnalysis"; saved public."ReferenceFormat"; format_id text;
begin
  select * into analysis from public."ReferenceAnalysis" where id=analysis_id for update;
  if analysis.id is null or analysis."createdByUserId" <> actor_id or not exists (
    select 1 from public."AppUser" where id=actor_id and role='creative_strategist'
  ) then raise exception 'Analysis is not accessible'; end if;
  if analysis."referenceFormatId" is not null then
    select * into saved from public."ReferenceFormat" where id=analysis."referenceFormatId";
    return to_jsonb(saved);
  end if;
  if analysis.status <> 'completed' or analysis.result is null then raise exception 'Analysis is not complete'; end if;
  format_id := 'reference-' || analysis_id::text;
  insert into public."ReferenceFormat" (id,slug,name,description,beats,"bestForAngle","optimalDurationSec","order","sourceKind","sourceUrl","sourceLabel","referenceAnalysisId",strategy)
  values (format_id,format_id,draft->>'name',draft->>'description',(draft->'beats')::text,draft->>'bestForAngle',
    (draft->>'duration')::integer,100,analysis.source->>'mode',nullif(analysis.source->>'url',''),
    coalesce(nullif(analysis.source->>'filename',''),analysis.source->>'url'),analysis_id,draft->'strategy') returning * into saved;
  update public."ReferenceAnalysis" set "referenceFormatId"=saved.id,"updatedAt"=now() where id=analysis_id;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_reference_framework(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_reference_framework(uuid,text,jsonb) to service_role;
