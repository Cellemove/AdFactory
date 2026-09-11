-- Migration 017: editable scorer evidence with immutable import provenance.
--
-- ScriptEvidence is the reviewer-facing record. ScriptEvidenceRevision retains
-- each distinct source row exactly as imported so normalized edits can never
-- erase the evidence trail.

create table if not exists "EvidenceImportRun" (
  id                    text primary key,
  provider              text not null default 'google_sheet'
                          check (provider in ('google_sheet', 'manual')),
  "sourceId"            text not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'running', 'complete', 'failed')),
  "selectedSheets"      jsonb not null default '[]'::jsonb,
  "workbookVersion"     text,
  counts                jsonb not null default '{}'::jsonb,
  warnings              jsonb not null default '[]'::jsonb,
  errors                jsonb not null default '[]'::jsonb,
  "requestedByUserId"   text references "AppUser"(id),
  "startedAt"           timestamptz,
  "completedAt"         timestamptz,
  "createdAt"           timestamptz not null default now()
);

create table if not exists "ScriptEvidence" (
  id                    text primary key,
  "sourceProvider"      text not null
                          check ("sourceProvider" in ('manual', 'google_sheet', 'milanote', 'brandsearch')),
  "sourceKey"           text not null unique,
  "spreadsheetId"       text,
  "sheetName"           text,
  "sourceRow"           integer check ("sourceRow" is null or "sourceRow" > 0),
  "externalId"          text,
  title                 text not null default '',
  format                text,
  avatar                text,
  "angleSlug"           text,
  "marketCode"          text,
  "adDate"              text,
  "launchedStatus"      text,
  "sourceStatus"        text,
  notes                 text,
  metrics               jsonb not null default '{}'::jsonb,
  "sourceLinks"         jsonb not null default '[]'::jsonb,
  "primarySourceUrl"    text,
  "sourceTypes"         jsonb not null default '[]'::jsonb,
  "scriptText"          text,
  "evidenceLevel"       text not null default 'observed'
                          check ("evidenceLevel" in ('observed', 'probable_winner', 'verified_winner')),
  "performanceEvidence" text,
  "reviewStatus"        text not null default 'unreviewed'
                          check ("reviewStatus" in ('unreviewed', 'needs_review', 'shortlisted', 'approved', 'rejected', 'excluded')),
  intent                text not null default 'structural_candidate'
                          check (intent in ('reference_only', 'structural_candidate')),
  "contentStatus"       text not null default 'source_only'
                          check ("contentStatus" in ('source_only', 'script_available', 'enrichment_pending', 'enrichment_failed')),
  "sourceValues"        jsonb not null default '{}'::jsonb,
  "overrideFields"      jsonb not null default '[]'::jsonb,
  "conflictFields"      jsonb not null default '[]'::jsonb,
  "latestSourceHash"    text,
  "lastImportedAt"      timestamptz,
  "createdByUserId"     text references "AppUser"(id),
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now(),
  check (
    "evidenceLevel" <> 'verified_winner'
    or nullif(btrim(coalesce("performanceEvidence", '')), '') is not null
  )
);

create table if not exists "ScriptEvidenceRevision" (
  id                    text primary key,
  "evidenceId"          text not null references "ScriptEvidence"(id) on delete cascade,
  "importRunId"         text references "EvidenceImportRun"(id) on delete set null,
  "spreadsheetId"       text,
  "sheetName"           text,
  "rowNumber"           integer,
  "rawHeaders"          jsonb not null default '[]'::jsonb,
  "rawCells"            jsonb not null default '[]'::jsonb,
  "sourceHash"          text not null,
  "extractedSourceUrls" jsonb not null default '[]'::jsonb,
  "importedAt"          timestamptz not null default now(),
  unique ("evidenceId", "sourceHash")
);

create table if not exists "EvidenceEnrichmentJob" (
  id                    text primary key,
  provider              text not null default 'milanote' check (provider = 'milanote'),
  "boardUrl"            text not null,
  "evidenceIds"         jsonb not null default '[]'::jsonb,
  status                text not null default 'pending'
                          check (status in ('pending', 'running', 'complete', 'needs_review', 'failed')),
  "matchCount"          integer,
  "errorSummary"        text,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create unique index if not exists scriptevidence_sheet_row_key
  on "ScriptEvidence" ("spreadsheetId", "sheetName", "sourceRow")
  where "spreadsheetId" is not null;
create index if not exists scriptevidence_review_idx
  on "ScriptEvidence" ("reviewStatus", "evidenceLevel", "updatedAt" desc);
create index if not exists scriptevidence_sheet_idx
  on "ScriptEvidence" ("sheetName", "sourceRow");
create index if not exists scriptevidence_revision_idx
  on "ScriptEvidenceRevision" ("evidenceId", "importedAt" desc);
create index if not exists evidenceimportrun_created_idx
  on "EvidenceImportRun" ("createdAt" desc);
create index if not exists evidenceenrichmentjob_status_idx
  on "EvidenceEnrichmentJob" (status, "createdAt");
create unique index if not exists evidenceenrichmentjob_board_key
  on "EvidenceEnrichmentJob" (provider, "boardUrl");

alter table "GoldAd" add column if not exists "sourceEvidenceId" text
  references "ScriptEvidence"(id) on delete set null;
create unique index if not exists goldad_source_evidence_key
  on "GoldAd" ("sourceEvidenceId") where "sourceEvidenceId" is not null;

-- Preserve manual evidence created by the interim Research-backed intake.
-- Malformed legacy payloads are skipped rather than failing the migration.
do $$
declare
  legacy record;
  payload jsonb;
  source_url text;
  evidence_id text;
begin
  for legacy in
    select * from "Research" where type = 'scorer_evidence_script'
  loop
    begin
      payload := legacy.drafts::jsonb;
    exception when others then
      continue;
    end;

    evidence_id := 'legacy_' || legacy.id;
    source_url := nullif(payload->>'sourceUrl', '');

    insert into "ScriptEvidence" (
      id, "sourceProvider", "sourceKey", "externalId", title, format,
      "angleSlug", "marketCode", notes, "sourceLinks", "primarySourceUrl",
      "sourceTypes", "scriptText", "evidenceLevel", "performanceEvidence",
      "reviewStatus", intent, "contentStatus", "sourceValues",
      "overrideFields", "createdByUserId", "createdAt", "updatedAt"
    ) values (
      evidence_id,
      'manual',
      'legacy_research:' || legacy.id,
      nullif(payload->>'externalId', ''),
      coalesce(nullif(payload->>'title', ''), coalesce(legacy.focus, legacy.id)),
      nullif(payload->>'format', ''),
      nullif(payload->>'angleSlug', ''),
      nullif(payload->>'marketCode', ''),
      coalesce(nullif(payload->>'notes', ''), legacy.notes),
      case when source_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('url', source_url, 'type', 'external_html')) end,
      source_url,
      case when source_url is null then '[]'::jsonb else '["external_html"]'::jsonb end,
      nullif(payload->>'scriptText', ''),
      coalesce(nullif(payload->>'evidenceLevel', ''), 'observed'),
      nullif(payload->>'performanceEvidence', ''),
      'needs_review',
      coalesce(nullif(payload->>'intent', ''), 'structural_candidate'),
      case when nullif(payload->>'scriptText', '') is null then 'source_only' else 'script_available' end,
      '{}'::jsonb,
      '["externalId","title","format","angleSlug","marketCode","notes","primarySourceUrl","scriptText","evidenceLevel","performanceEvidence","reviewStatus","intent"]'::jsonb,
      nullif(payload->>'capturedByUserId', ''),
      legacy."createdAt",
      legacy."createdAt"
    ) on conflict ("sourceKey") do nothing;

    insert into "ScriptEvidenceRevision" (
      id, "evidenceId", "rawHeaders", "rawCells", "sourceHash", "extractedSourceUrls", "importedAt"
    ) values (
      'legacy_revision_' || legacy.id,
      evidence_id,
      '["Research.drafts"]'::jsonb,
      jsonb_build_array(legacy.drafts),
      coalesce(nullif(payload->>'contentHash', ''), md5(legacy.drafts)),
      case when source_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('url', source_url, 'type', 'external_html')) end,
      legacy."createdAt"
    ) on conflict ("evidenceId", "sourceHash") do nothing;
  end loop;
end $$;
