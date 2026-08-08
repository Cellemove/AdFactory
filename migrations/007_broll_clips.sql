-- Migration 007: Google Drive b-roll index.
-- The team shares a Drive folder of b-roll with the service account; we index the
-- video clips here so the Designer / Creative-Briefs stages can match beats to real
-- clips instead of suggesting b-roll in the abstract. Idempotent.

create table if not exists "BrollClip" (
  id             text primary key,
  "driveId"      text not null unique,
  name           text not null,
  "mimeType"     text not null,
  "folderPath"   text,
  "webViewLink"  text,
  "thumbnailLink" text,
  description    text,
  "durationMs"   bigint,
  "sizeBytes"    bigint,
  "indexedAt"    timestamptz not null default now()
);

create index if not exists brollclip_name_idx on "BrollClip" (name);
create index if not exists brollclip_folder_idx on "BrollClip" ("folderPath");
