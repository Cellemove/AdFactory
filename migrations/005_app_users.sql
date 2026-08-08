-- Migration 005: simple username/password auth.
-- Replaces Supabase Auth (which requires email) with our own user table.
-- Passwords are stored as scrypt hashes (see src/lib/password.ts). Sessions are
-- signed cookies (see src/lib/session.ts) — no Supabase Auth involved.

create table if not exists "AppUser" (
  id            text primary key,
  username      text not null,
  "passwordHash" text not null,
  role          text not null default 'creative_strategist',
  "createdAt"   timestamptz not null default now()
);

-- Usernames are stored already-normalized (lowercased); enforce uniqueness.
create unique index if not exists appuser_username_key on "AppUser" (username);
