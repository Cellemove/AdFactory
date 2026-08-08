import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import cuid from "cuid";
import type { Database } from "./database.types";

// Server-side Supabase client using the service-role key. Bypasses RLS (we don't
// have RLS configured — the entire app is server-side). Uses HTTPS to PostgREST,
// so there are no DB connection pool concerns on serverless.
//
// Lazy: the client is built on first use, not at module load. This lets the
// build pass even when env vars aren't set (e.g. during `next build` if the
// CI env is incomplete) — the error only fires when an actual query happens.

let cached: SupabaseClient<Database> | null = null;

function build(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Proxy that lazy-constructs the client on first property access. Keeps the
// `supabase.from(...)` import pattern across the app while deferring env-var
// validation to runtime.
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    if (!cached) cached = build();
    const value = (cached as unknown as Record<string | symbol, unknown>)[prop as string];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(cached) : value;
  },
});

// IDs were `@default(cuid())` in the Prisma schema. Without Prisma we generate
// them application-side. Use this for every `insert`.
export function newId(): string {
  return cuid();
}

// Helper: throw on supabase response error so call sites can stay terse.
// Works for both single (.single()) and list (.select()) queries — T is the
// type of `res.data` (object or array).
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("supabase returned null data");
  return res.data;
}

export function unwrapOpt<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
