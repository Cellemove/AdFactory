// Password hashing with Node's built-in scrypt — no external deps. Only imported
// from server actions (Node runtime), never from the edge middleware.
import "server-only";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** Hash a password. Returns `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash` string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const target = Buffer.from(hashHex, "hex");
  const dk = (await scryptAsync(password, Buffer.from(saltHex, "hex"), KEYLEN)) as Buffer;
  return dk.length === target.length && timingSafeEqual(dk, target);
}
