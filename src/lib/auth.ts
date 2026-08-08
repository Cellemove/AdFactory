// Server-side session helper. Use in the layout, server components, and server
// actions to know who's logged in and what they may do. Reads the signed session
// cookie — no DB lookup, no Supabase Auth.
import "server-only";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import type { Role } from "@/lib/roles";

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const payload = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { id: payload.uid, username: payload.username, role: payload.role };
}
