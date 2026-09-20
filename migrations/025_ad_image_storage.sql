-- Migration 025: ad images move to Supabase Storage.
--
-- Product shots, winner imports, archived competitor references and generated
-- image ads all used to go to Vercel Blob, which meant a second storage provider
-- with its own token to keep alive, and a local-disk fallback that behaved
-- differently in dev. One Supabase bucket serves every environment identically.
--
-- The bucket is PUBLIC: the stored URL goes straight into <img src> across
-- /products, /winners, /reviews and /image-ads, exactly as the blob URLs did.
-- Objects are unguessable (UUID filenames) but not access-controlled; anyone
-- with a link can open one. Making it private would mean storing object paths
-- instead of URLs and streaming through an authenticated route.
--
-- Objects live at <prefix>/<filename> where prefix is one of: products,
-- winners, winners-import, image-ad-references, image-ad-candidates.
-- Idempotent: safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-images', 'ad-images', true, 15728640,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads are public; writes stay server-side through the service-role key, which
-- bypasses RLS, so no write policy is needed.
drop policy if exists "ad-images public read" on storage.objects;
create policy "ad-images public read"
  on storage.objects for select
  using (bucket_id = 'ad-images');
