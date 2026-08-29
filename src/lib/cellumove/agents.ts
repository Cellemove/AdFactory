// The agent layer. An "agent" here = a role + the SOPs that role reads + one
// Gemini call. Each agent's system prompt is assembled at call time from:
//   1. the caller's base task instruction, and
//   2. the SOP rows whose roleScope matches this role (or 'all'), filtered to
//      the active market.
// This is what makes the roster real: write a SOP in /knowledge, and the
// matching agent starts obeying it on the next run — no code change.

import { supabase } from "../db";
import { getLLM, DEFAULT_MODEL } from "../llm";
import { recordUsage } from "../usage";
import type { SopRow } from "../database.types";

export type AgentRole = "strategist" | "copywriter" | "researcher" | "designer";

export interface RunAgentOptions {
  role: AgentRole;
  // Additional SOP roles to load for cross-functional generation turns.
  additionalRoles?: AgentRole[];
  // Base task instruction — what this agent is being asked to do this call.
  instruction: string;
  // The user-turn content (context, data, the actual request).
  context: string;
  // Active market code (e.g. "de"). Pulls in market-scoped SOPs + is recorded.
  marketCode?: string | null;
  // When true, request strict JSON output mode (only valid when NOT grounded —
  // Vertex disallows tools + responseMimeType together).
  json?: boolean;
  grounded?: boolean;
  feature: string;                       // usage tag, e.g. "pipeline_strategist"
  metadata?: Record<string, unknown>;
  maxOutputTokens?: number;
  thinkingBudget?: number;
}

// Best-effort SOP load. Tolerates a not-yet-migrated DB (returns nothing) so the
// pipeline still runs on the engine's built-in rules before any SOPs are written.
async function loadRoleSops(roles: AgentRole[], marketCode?: string | null): Promise<SopRow[]> {
  try {
    const roleScopes = [...new Set<AgentRole | "all">([...roles, "all"])];
    const res = await supabase
      .from("Sop")
      .select("*")
      .in("roleScope", roleScopes)
      .order("pinned", { ascending: false })
      .order("order", { ascending: true });
    if (res.error) return [];
    const rows = (res.data ?? []) as SopRow[];
    // Keep global SOPs (marketScope null) + ones matching the active market.
    return rows.filter((s) => !s.marketScope || (marketCode && s.marketScope === marketCode));
  } catch {
    return [];
  }
}

function renderSops(rows: SopRow[]): string {
  if (rows.length === 0) return "";
  const blocks = rows.map((s) => {
    const head = `## SOP — ${s.title}${s.marketScope ? ` [market: ${s.marketScope}]` : ""}`;
    const body = s.body?.trim() ? s.body.trim() : "(no prose body)";
    const payload = s.payload?.trim() ? `\nStructured payload (JSON):\n${s.payload.trim()}` : "";
    return `${head}\n${body}${payload}`;
  });
  return [
    "",
    "════════════════════════════════════════════════════════════════════════",
    "STANDING SOPs — these are house rules. Follow them exactly; they override",
    "your defaults where they conflict.",
    "════════════════════════════════════════════════════════════════════════",
    blocks.join("\n\n"),
  ].join("\n");
}

// Pull the first balanced JSON object out of a model response, tolerating the
// code-fence wrapping Gemini sometimes adds despite instructions.
export function extractJsonObject<T>(text: string): T {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim()) as T;
    } catch {
      /* try next */
    }
  }
  throw new Error("Agent response was not valid JSON.");
}

// Run one agent turn. Returns the raw text; callers parse with extractJsonObject
// when they passed json:true.
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const roles = [...new Set([opts.role, ...(opts.additionalRoles ?? [])])];
  const sops = await loadRoleSops(roles, opts.marketCode);
  const system = `${opts.instruction}${renderSops(sops)}`;

  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: opts.context,
    config: {
      systemInstruction: system,
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
      // JSON mode and grounding are mutually exclusive on Vertex.
      ...(opts.grounded
        ? { tools: [{ googleSearch: {} }] }
        : opts.json
          ? { responseMimeType: "application/json" }
          : {}),
      thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 2048 },
    },
  });
  await recordUsage({
    feature: opts.feature,
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: opts.grounded,
    metadata: { role: opts.role, sopRoles: roles, market: opts.marketCode ?? undefined, sopCount: sops.length, ...opts.metadata },
  });

  const text = resp.text;
  if (!text || !text.trim()) throw new Error(`${opts.role} agent returned no text.`);
  return text;
}
