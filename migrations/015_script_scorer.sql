-- Migration 015: experimental Script Studio scorer.
-- Score runs always point at an immutable ScriptVersion and retain versioned
-- engine/taxonomy/baseline provenance so historical results stay reproducible.

create extension if not exists vector with schema extensions;

create table if not exists "CopyTaxonomyCode" (
  version               text not null,
  code                  text not null,
  layer                 text not null check (layer in ('H', 'Q', 'P', 'B', 'M', 'PR', 'O', 'OTHER')),
  label                 text not null,
  description           text not null,
  "createdAt"           timestamptz not null default now(),
  primary key (version, code),
  unique (version, code, layer)
);

insert into "CopyTaxonomyCode" (version, code, layer, label, description)
values
  ('copy-taxonomy-v1', 'H_OPENING', 'H', 'Opening hook', 'The first attention-setting statement or visual premise.'),
  ('copy-taxonomy-v1', 'Q_QUESTION', 'Q', 'Audience question', 'A direct or implied question addressed to the audience.'),
  ('copy-taxonomy-v1', 'P_PROBLEM', 'P', 'Problem', 'The audience problem, frustration, or stakes.'),
  ('copy-taxonomy-v1', 'B_BENEFIT', 'B', 'Benefit', 'A desired experience or supportable product benefit.'),
  ('copy-taxonomy-v1', 'M_MECHANISM', 'M', 'Mechanism', 'How the product or proposed solution is said to work.'),
  ('copy-taxonomy-v1', 'PR_PROOF', 'PR', 'Proof', 'Evidence, demonstration, testimonial, or objection handling.'),
  ('copy-taxonomy-v1', 'O_OFFER', 'O', 'Offer', 'Price, bundle, bonus, guarantee, or availability.'),
  ('copy-taxonomy-v1', 'O_CTA', 'O', 'Call to action', 'The explicit next step.'),
  ('copy-taxonomy-v1', 'OTHER', 'OTHER', 'Other', 'A deliberate beat that does not fit the closed v1 taxonomy.')
on conflict (version, code) do nothing;

create table if not exists "GoldAd" (
  id                    text primary key,
  "externalId"          text not null,
  title                 text not null,
  "angleSlug"           text not null,
  format                text not null,
  "marketCode"          text,
  "durationSec"         double precision,
  "scriptText"          text not null,
  "baselineVersion"     text not null,
  "taxonomyVersion"     text not null,
  "createdAt"           timestamptz not null default now(),
  unique ("baselineVersion", "externalId")
);

create table if not exists "GoldBeat" (
  id                    text primary key,
  "goldAdId"            text not null references "GoldAd"(id) on delete cascade,
  "taxonomyVersion"     text not null,
  "orderIndex"          integer not null check ("orderIndex" >= 0),
  layer                 text not null check (layer in ('H', 'Q', 'P', 'B', 'M', 'PR', 'O', 'OTHER')),
  code                  text not null,
  "startSec"            double precision,
  "endSec"              double precision,
  "evidenceQuote"       text not null,
  "otherExplanation"    text,
  "createdAt"           timestamptz not null default now(),
  unique ("goldAdId", "orderIndex"),
  foreign key ("taxonomyVersion", code, layer) references "CopyTaxonomyCode"(version, code, layer)
);

create table if not exists "BrandFact" (
  id                    text primary key,
  "productId"           text not null references "Product"(id) on delete cascade,
  "marketCode"          text,
  "factType"            text not null,
  statement             text not null,
  "normalizedStatement" text not null,
  "sourceUrl"           text,
  status                text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  "approvedByUserId"    text references "AppUser"(id),
  "approvedAt"          timestamptz,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create table if not exists "ProductOffer" (
  id                    text primary key,
  "productId"           text not null references "Product"(id) on delete cascade,
  "marketCode"          text,
  "offerType"           text not null,
  statement             text not null,
  "sourceUrl"           text,
  status                text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  "validFrom"           timestamptz,
  "validUntil"          timestamptz,
  "approvedByUserId"    text references "AppUser"(id),
  "approvedAt"          timestamptz,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

alter table "Verbatim" add column if not exists embedding extensions.vector(768);
alter table "Verbatim" add column if not exists "embeddingModel" text;
alter table "Verbatim" add column if not exists "embeddingVersion" text not null default 'v1';

create table if not exists "ScriptScoreRun" (
  id                        text primary key,
  "runKey"                  text not null unique,
  "projectId"               text not null,
  "scriptVersion"           integer not null,
  status                    text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  "marketCode"              text not null,
  "inputHash"               text not null,
  "engineVersion"           text not null,
  "extractorPromptVersion"  text not null,
  "taxonomyVersion"         text not null,
  "baselineVersion"         text not null,
  model                     text not null,
  "createdByUserId"         text not null references "AppUser"(id),
  "startedAt"               timestamptz,
  "completedAt"             timestamptz,
  "errorCode"               text,
  "errorSummary"            text,
  "contextSnapshot"         jsonb not null,
  "createdAt"               timestamptz not null default now(),
  foreign key ("projectId", "scriptVersion") references "ScriptVersion"("projectId", version) on delete cascade
);

create table if not exists "ScriptScoreModule" (
  "runId"                   text not null references "ScriptScoreRun"(id) on delete cascade,
  module                    text not null check (module in ('structural_fit', 'verbatim_grounding', 'specificity', 'fact_verification', 'observer_flags')),
  status                    text not null check (status in ('scored', 'not_configured', 'insufficient_evidence', 'failed')),
  score                     double precision check (score is null or (score >= 0 and score <= 100)),
  label                     text not null,
  summary                   text not null,
  metrics                   jsonb not null default '{}'::jsonb,
  primary key ("runId", module)
);

create table if not exists "ScriptScoreFinding" (
  id                        text primary key,
  "runId"                   text not null references "ScriptScoreRun"(id) on delete cascade,
  module                    text not null check (module in ('structural_fit', 'verbatim_grounding', 'specificity', 'fact_verification', 'observer_flags')),
  severity                  text not null check (severity in ('info', 'warning', 'critical')),
  "scriptModuleId"          text,
  "lineIndex"               integer,
  "scriptQuote"             text,
  message                   text not null,
  recommendation            text,
  "evidenceType"            text,
  "evidenceId"              text,
  "evidenceQuote"           text,
  similarity                double precision,
  metadata                  jsonb not null default '{}'::jsonb,
  "createdAt"               timestamptz not null default now()
);

create index if not exists goldad_cohort_idx on "GoldAd" ("baselineVersion", "angleSlug", format);
create index if not exists goldbeat_ad_idx on "GoldBeat" ("goldAdId", "orderIndex");
create index if not exists brandfact_product_market_idx on "BrandFact" ("productId", "marketCode", status);
create index if not exists productoffer_product_market_idx on "ProductOffer" ("productId", "marketCode", status);
create index if not exists scriptscorerun_project_idx on "ScriptScoreRun" ("projectId", "scriptVersion", "createdAt" desc);
create index if not exists scriptscorefinding_run_idx on "ScriptScoreFinding" ("runId", module, "lineIndex");
create index if not exists verbatim_embedding_hnsw_idx
  on "Verbatim" using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create or replace function match_verbatims(
  query_embedding extensions.vector(768),
  match_count integer default 5,
  filter_sub_avatar_id text default null,
  filter_angle_slug text default null,
  filter_market text default null
)
returns table (
  id text,
  text text,
  "sourceUrl" text,
  similarity double precision
)
language sql
stable
as $$
  select
    v.id,
    v.text,
    v."sourceUrl",
    1 - (v.embedding <=> query_embedding) as similarity
  from "Verbatim" v
  where v.embedding is not null
    and v."researchId" like 'verified:%'
    and (filter_sub_avatar_id is null or v."subAvatarId" = filter_sub_avatar_id)
    and (filter_angle_slug is null or v."angleSlug" = filter_angle_slug)
    and (filter_market is null or upper(v.market) = upper(filter_market))
  order by v.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;
