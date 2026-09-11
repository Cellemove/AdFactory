-- Migration 019: corpus videos move from the local disk to Supabase Storage.
--
-- MEDIA used to write videos to corpus-media/ on whichever machine ran it, so a
-- copy downloaded from a laptop was invisible to the deployed app, and Vercel
-- cannot keep files at all. A private bucket makes one durable copy that the
-- CLI runners and the /miner/run page share. Objects live at
-- <competitorAdId>/<sha256>.<ext>; the hash is still verified on every read.
-- Idempotent: safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('corpus-media', 'corpus-media', false, 15728640,
        array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/mpeg', 'video/3gpp'])
on conflict (id) do nothing;

alter table "AdMedia" add column if not exists "storagePath" text;

-- Teardown's fallback now uploads the stored copy, not a local file.
alter table "AdTeardown" drop constraint if exists "AdTeardown_sourceKind_check";
update "AdTeardown" set "sourceKind" = 'stored_copy' where "sourceKind" = 'local_file';
alter table "AdTeardown" add constraint "AdTeardown_sourceKind_check"
  check ("sourceKind" in ('video_sd_url', 'video_hd_url', 'videoUrl', 'stored_copy'));
