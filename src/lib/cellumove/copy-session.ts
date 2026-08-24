// Copywriter session doc — the conversation persisted as JSON in a Research row
// (type "copywriter"). Shared by the action, the page loader, and the client.

import type { ClaimScan } from "./claim-check";

export interface CopyTurn {
  role: "user" | "copywriter";
  text: string;
  at: string;
  claims?: ClaimScan; // compliance scan — copywriter turns only
}

export interface CopySessionDoc {
  subAvatarId: string;
  angleSlug: string;
  turns: CopyTurn[];
}

export function parseCopySessionDoc(raw: string): CopySessionDoc {
  try {
    const d = JSON.parse(raw) as Partial<CopySessionDoc>;
    return {
      subAvatarId: d.subAvatarId ?? "",
      angleSlug: d.angleSlug ?? "",
      turns: Array.isArray(d.turns) ? d.turns : [],
    };
  } catch {
    return { subAvatarId: "", angleSlug: "", turns: [] };
  }
}
