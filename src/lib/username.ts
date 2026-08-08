// Username helpers for simple username/password auth. No email involved.

/** Normalize a username: trim, lowercase, keep only letters, digits, . _ - */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}
