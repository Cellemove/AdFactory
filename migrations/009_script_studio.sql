-- Migration 009: Script Studio foundation.
-- Structured scripts live as versioned JSONB documents; ownership, assignment,
-- status, and source references remain relational and queryable.

alter table "AppUser" add column if not exists "shortCode" text;
update "AppUser"
set "shortCode" = left(upper(regexp_replace(username, '[^a-zA-Z0-9]+', '', 'g')), 12)
where "shortCode" is null or btrim("shortCode") = '';

alter table "Product" add column if not exists code text;
alter table "Product" add column if not exists context jsonb not null default '{}'::jsonb;

with ranked as (
  select id, row_number() over (order by "createdAt", id) as position
  from "Product"
)
update "Product" p
set code = 'V' || ranked.position::text
from ranked
where p.id = ranked.id and (p.code is null or btrim(p.code) = '');

create unique index if not exists product_code_key on "Product" (upper(code)) where code is not null;

create table if not exists "ScriptProject" (
  id                    text primary key,
  title                 text not null,
  status                text not null default 'draft'
                        check (status in ('draft', 'generating', 'review', 'assigned', 'available', 'submitted', 'changes_requested', 'approved')),
  "strategistUserId"    text not null references "AppUser"(id),
  "editorUserId"        text references "AppUser"(id),
  "createdByUserId"     text not null references "AppUser"(id),
  "productId"           text not null references "Product"(id),
  "subAvatarId"         text references "SubAvatar"(id),
  "angleId"             text not null references "Angle"(id),
  "referenceFormatId"   text references "ReferenceFormat"(id),
  idea                   text not null,
  "adNumber"            text not null,
  "creativeName"        text not null,
  format                 text not null,
  "targetDurationSec"   integer not null default 30 check ("targetDurationSec" between 5 and 600),
  "teardownRecordId"    text,
  "teardownSnapshot"    jsonb,
  document               jsonb not null,
  "displayName"         text not null,
  revision               integer not null default 0,
  "currentVersion"      integer not null default 1,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create table if not exists "ScriptVersion" (
  id                    text primary key,
  "projectId"           text not null references "ScriptProject"(id) on delete cascade,
  version               integer not null,
  document              jsonb not null,
  origin                text not null check (origin in ('created', 'manual', 'generated', 'assigned', 'submitted', 'reviewed')),
  "changeSummary"       text not null,
  model                 text,
  "promptVersion"       text,
  "createdByUserId"     text not null references "AppUser"(id),
  "createdAt"           timestamptz not null default now(),
  unique ("projectId", version)
);

create table if not exists "ScriptAssignment" (
  id                    text primary key,
  "projectId"           text not null unique references "ScriptProject"(id) on delete cascade,
  "editorUserId"        text references "AppUser"(id),
  status                text not null default 'available'
                        check (status in ('available', 'assigned', 'claimed', 'submitted', 'changes_requested', 'approved')),
  "deliveryUrl"         text,
  "reviewNote"          text,
  "reviewedByUserId"    text references "AppUser"(id),
  "assignedAt"          timestamptz,
  "claimedAt"           timestamptz,
  "submittedAt"         timestamptz,
  "reviewedAt"          timestamptz,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create table if not exists "ScriptSource" (
  id          text primary key,
  "projectId" text not null references "ScriptProject"(id) on delete cascade,
  "sourceType" text not null check ("sourceType" in ('teardown', 'broll', 'research', 'manual')),
  "sourceId" text,
  title       text not null,
  url         text,
  snapshot    jsonb,
  "createdAt" timestamptz not null default now()
);

create table if not exists "ScriptEvent" (
  id          text primary key,
  "projectId" text not null references "ScriptProject"(id) on delete cascade,
  "actorUserId" text references "AppUser"(id),
  "eventType" text not null,
  payload     jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now()
);

create index if not exists scriptproject_status_idx on "ScriptProject" (status, "updatedAt" desc);
create index if not exists scriptproject_strategist_idx on "ScriptProject" ("strategistUserId", "updatedAt" desc);
create index if not exists scriptproject_editor_idx on "ScriptProject" ("editorUserId", "updatedAt" desc);
create index if not exists scriptversion_project_idx on "ScriptVersion" ("projectId", version desc);
create index if not exists scriptsource_project_idx on "ScriptSource" ("projectId", "sourceType");
create index if not exists scriptevent_project_idx on "ScriptEvent" ("projectId", "createdAt" desc);
