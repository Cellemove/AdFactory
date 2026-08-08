"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase, newId } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { normalizeUsername } from "@/lib/username";
import { parseRole, type Role } from "@/lib/roles";
import type { AppUserRow } from "@/lib/database.types";

type Result = { error: string };

const isProd = process.env.NODE_ENV === "production";

async function setSessionCookie(user: { id: string; username: string; role: Role }): Promise<void> {
  const token = await signSession({ uid: user.id, username: user.username, role: user.role });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Create a new account, then sign in. Fails if the username is taken. */
export async function signUpAction(input: {
  username: string;
  password: string;
  role: string;
  next?: string;
}): Promise<Result | void> {
  const username = normalizeUsername(input.username);
  if (!username) return { error: "Enter a username (letters, digits, . _ - )." };
  if (!input.password || input.password.length < 6)
    return { error: "Password must be at least 6 characters." };

  const role = parseRole(input.role);

  const existing = await supabase.from("AppUser").select("id").eq("username", username).maybeSingle();
  if (existing.error) return { error: existing.error.message };
  if (existing.data) return { error: "That username is taken. Pick another." };

  const passwordHash = await hashPassword(input.password);
  const ins = await supabase.from("AppUser").insert({
    id: newId(),
    username,
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  });
  if (ins.error) {
    // Unique-index race → surface a friendly message.
    if (/duplicate|unique/i.test(ins.error.message)) return { error: "That username is taken. Pick another." };
    return { error: ins.error.message };
  }

  const created = await supabase.from("AppUser").select("*").eq("username", username).single();
  if (created.error || !created.data) return { error: "Account created — please sign in." };
  const row = created.data as AppUserRow;
  await setSessionCookie({ id: row.id, username: row.username, role: parseRole(row.role) });
  redirect(safeNext(input.next, parseRole(row.role)));
}

/** Verify credentials and start a session. */
export async function signInAction(input: {
  username: string;
  password: string;
  next?: string;
}): Promise<Result | void> {
  const username = normalizeUsername(input.username);
  if (!username || !input.password) return { error: "Enter your username and password." };

  const res = await supabase.from("AppUser").select("*").eq("username", username).maybeSingle();
  if (res.error) return { error: res.error.message };
  const row = res.data as AppUserRow | null;
  // Always run a hash comparison to avoid leaking whether the username exists.
  const stored = row?.passwordHash ?? "scrypt$00$00";
  const ok = await verifyPassword(input.password, stored);
  if (!row || !ok) return { error: "Wrong username or password." };

  const role = parseRole(row.role);
  await setSessionCookie({ id: row.id, username: row.username, role });
  redirect(safeNext(input.next, role));
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

// Only allow same-origin relative redirects; editors always land on /reviews.
function safeNext(next: string | undefined, role: Role): string {
  if (role === "editor") return "/reviews";
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}
