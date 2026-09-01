-- Migration 011: evidence-first research architecture.
--
-- Adds a reusable, source-addressable evidence ledger beside the existing
-- Research JSON snapshots. Existing research rows remain valid. Statements are
-- idempotent so this file can be re-run safely in the Supabase SQL editor.

create extension if not exists vector with schema extensions;

alter table "Research" add column if not exists "queryPlan" jsonb;
alter table "Research" add column if not exists "qualityScore" integer;
alter table "Research" add column if not exists "qualityStatus" text;
alter table "Research" add column if not exists "qualityReport" jsonb;

create table if not exists "ResearchSource" (
  id                text primary key,
  "researchId"      text not null references "Research"(id) on delete cascade,
  "canonicalUrl"    text not null,
  domain             text not null,
  "sourceType"      text not null,
  title              text,
  author             text,
  "publishedAt"     timestamptz,
  "retrievedAt"     timestamptz not null default now(),
  status             text not null default 'unchecked',
  "httpStatus"      integer not null default 0,
  excerpt             text,
  "contentHash"      text,
  metadata             jsonb not null default '{}'::jsonb,
  unique ("researchId", "canonicalUrl")
);

create table if not exists "ResearchEvidence" (
  id                    text primary key,
  "researchId"          text not null references "Research"(id) on delete cascade,
  "sourceId"            text references "ResearchSource"(id) on delete set null,
  "draftKey"            text not null,
  category                text not null,
  "evidenceType"         text not null check ("evidenceType" in ('verbatim', 'claim', 'inference')),
  text                    text not null,
  "normalizedText"       text not null,
  "sourceUrl"            text,
  "verificationStatus"   text not null default 'unchecked'
                          check ("verificationStatus" in ('verified', 'source_checked', 'unverified', 'inference')),
  confidence              double precision not null default 0,
  "contentHash"          text not null,
  embedding               extensions.vector(768),
  "embeddingModel"       text,
  "embeddingVersion"     text not null default 'v1',
  metadata                jsonb not null default '{}'::jsonb,
  "createdAt"             timestamptz not null default now(),
  unique ("researchId", "draftKey", "contentHash")
);

create table if not exists "ResearchFeedback" (
  id              text primary key,
  "researchId"    text not null references "Research"(id) on delete cascade,
  "draftKey"      text not null,
  "evidenceId"    text references "ResearchEvidence"(id) on delete cascade,
  rating           text not null check (rating in ('useful', 'generic', 'incorrect', 'duplicate', 'used_in_script')),
  note             text,
  "createdAt"      timestamptz not null default now()
);

create index if not exists researchsource_research_idx
  on "ResearchSource" ("researchId", "sourceType");
create index if not exists researchsource_domain_idx
  on "ResearchSource" (domain);
create index if not exists researchevidence_research_idx
  on "ResearchEvidence" ("researchId", "draftKey");
create index if not exists researchevidence_filter_idx
  on "ResearchEvidence" (category, "verificationStatus", "createdAt" desc);
create index if not exists researchevidence_text_idx
  on "ResearchEvidence" using gin (to_tsvector('english', text));
create index if not exists researchfeedback_research_idx
  on "ResearchFeedback" ("researchId", "draftKey", "createdAt" desc);

-- HNSW is appropriate for the expected evidence corpus and avoids the training
-- requirement of IVFFlat. Rows without embeddings remain searchable by text.
create index if not exists researchevidence_embedding_hnsw_idx
  on "ResearchEvidence" using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Dense half of hybrid retrieval. Keyword search is executed separately and
-- fused in application code with reciprocal-rank fusion so both rankings remain
-- inspectable and independently evaluable.
create or replace function match_research_evidence(
  query_embedding extensions.vector(768),
  match_count integer default 20,
  filter_angle_slug text default null,
  filter_category text default null
)
returns table (
  id text,
  "researchId" text,
  "draftKey" text,
  category text,
  text text,
  "sourceUrl" text,
  "verificationStatus" text,
  similarity double precision
)
language sql
stable
as $$
  select
    e.id,
    e."researchId",
    e."draftKey",
    e.category,
    e.text,
    e."sourceUrl",
    e."verificationStatus",
    1 - (e.embedding <=> query_embedding) as similarity
  from "ResearchEvidence" e
  join "Research" r on r.id = e."researchId"
  where e.embedding is not null
    and (filter_angle_slug is null or r."angleSlug" = filter_angle_slug)
    and (filter_category is null or e.category = filter_category)
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 100));
$$;

