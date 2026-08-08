// Stateless signed-cookie sessions. Uses Web Crypto (crypto.subtle) so the SAME
// code verifies tokens in both the edge middleware and Node server code.
//
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature).
// No secrets or DB rows are stored in the cookie beyond id/username/role/exp.
//
// This file must stay edge-safe: NO node:crypto, NO next/headers imports. Cookie
// reading/writing happens at call sites (server actions use next/headers; the
// middleware uses request/response cookies).
import type { Role } from "@/lib/roles";

export const SESSION_COOKIE = "cm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

export type SessionPayload = {
  uid: string;
  username: string;
  role: Role;
  exp: number; // unix seconds
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function secretString(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "dev-insecure-secret-change-me"
  );
}

// Web Crypto wants BufferSource; TS's lib.dom narrows Uint8Array's backing buffer
// too strictly, so we widen at the boundary.
function buf(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    buf(enc.encode(secretString())),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  if (pad) t += "=".repeat(4 - pad);
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Sign a session. Pass id/username/role; exp is set here (SESSION_MAX_AGE). */
export async function signSession(input: Omit<SessionPayload, "exp">): Promise<string> {
  const payload: SessionPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const payloadB64 = toB64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await getKey(), buf(enc.encode(payloadB64)));
  return `${payloadB64}.${toB64url(new Uint8Array(sig))}`;
}

/** Verify + decode a session token. Returns null if tampered or expired. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      buf(fromB64url(sigB64)),
      buf(enc.encode(payloadB64)),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(payloadB64))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.uid || !payload.username) return null;
    return payload;
  } catch {
    return null;
  }
}
