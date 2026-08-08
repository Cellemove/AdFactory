// Worker roles + rights. Pure (no imports) so both the edge middleware and
// server code can use it. The role is stored on the AppUser row and copied into
// the signed session cookie at login (no DB lookup needed to gate a request).

export type Role = "creative_strategist" | "editor";

export const ROLE_LABELS: Record<Role, string> = {
  creative_strategist: "Creative Strategist",
  editor: "Editor",
};

// Coerce any stored/incoming value to a valid Role. Defaults to creative_strategist
// (full access) when unset/unknown; editors are explicitly marked "editor".
export function parseRole(value: unknown): Role {
  return value === "editor" ? "editor" : "creative_strategist";
}
