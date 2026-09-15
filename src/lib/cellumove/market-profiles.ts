// Seed payload for the MarketProfile table — per-market tone + claims rules
// (Modules 11 & 12). These are STARTER STUBS: tone is seeded from the known
// house rules (UK = sober, ES = emotional, DE = technical); the claims arrays
// are intentionally light so the strategist fills them as real rules land.

export interface MarketProfileSeed {
  code: string;
  name: string;
  tone: string;
  vocabulary: { favor: string[]; avoid: string[] };
  hooksThatWork: string[];
  hooksThatFlop: string[];
  allowedClaims: string[];
  forbiddenClaims: string[];
  disclaimerClaims: string[];
  trustpilotScore: string;
  culturalNotes: string;
  order: number;
}

const EMPTY = {
  vocabulary: { favor: [], avoid: [] },
  hooksThatWork: [],
  hooksThatFlop: [],
  allowedClaims: [],
  forbiddenClaims: [],
  disclaimerClaims: [],
  trustpilotScore: "",
  culturalNotes: "",
};

export const MARKET_PROFILES: MarketProfileSeed[] = [
  { code: "uk", name: "United Kingdom", tone: "Sober, understated, dry. Avoid hype and exclamation. Earn trust with restraint and honesty.", ...EMPTY, order: 1 },
  { code: "es", name: "Spain", tone: "Emotional, warm, expressive. Lean into feeling and the human story over specs.", ...EMPTY, order: 2 },
  { code: "de", name: "Germany", tone: "Technical, precise, evidence-led. Explain the mechanism; skeptical of vague promises.", ...EMPTY, order: 3 },
  { code: "cz", name: "Czechia", tone: "Practical, no-nonsense, value-aware.", ...EMPTY, order: 4 },
  { code: "pl", name: "Poland", tone: "Direct, value-driven, trust through specifics.", ...EMPTY, order: 5 },
  { code: "pt", name: "Portugal", tone: "Warm, relational, gently emotional.", ...EMPTY, order: 6 },
  { code: "gr", name: "Greece", tone: "Expressive, community-oriented, story-led.", ...EMPTY, order: 7 },
  { code: "se", name: "Sweden", tone: "Calm, minimal, design-led. Understated like UK but cleaner.", ...EMPTY, order: 8 },
  { code: "nz", name: "New Zealand", tone: "Friendly, plain-spoken, low-hype.", ...EMPTY, order: 9 },
  { code: "au", name: "Australia", tone: "Casual, confident, conversational.", ...EMPTY, order: 10 },
  { code: "ca", name: "Canada", tone: "Polite, reassuring, balanced between US energy and UK restraint.", ...EMPTY, order: 11 },
];

// ─── Prompt block from a DB row ──────────────────────────────────────────────
// MarketProfile string columns hold JSON arrays/objects; parse fail-soft so one
// malformed column never breaks generation.
import type { MarketProfileRow } from "@/lib/database.types";

function jsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export interface MarketProfileBlock {
  market: string;
  tone: string;
  vocabulary: { favor: string[]; avoid: string[] };
  hooksThatWork: string[];
  hooksThatFlop: string[];
  claims: { allowed: string[]; forbidden: string[]; disclaimers: string[] };
  culturalNotes: string | null;
}

export function renderMarketProfileBlock(row: MarketProfileRow | null | undefined): MarketProfileBlock | null {
  if (!row) return null;
  let vocabulary: { favor: string[]; avoid: string[] } = { favor: [], avoid: [] };
  if (row.vocabulary) {
    try {
      const parsed = JSON.parse(row.vocabulary) as { favor?: unknown; avoid?: unknown };
      vocabulary = {
        favor: Array.isArray(parsed.favor) ? parsed.favor.filter((item): item is string => typeof item === "string") : [],
        avoid: Array.isArray(parsed.avoid) ? parsed.avoid.filter((item): item is string => typeof item === "string") : [],
      };
    } catch { /* keep empty */ }
  }
  return {
    market: `${row.name} (${row.code})`,
    tone: row.tone,
    vocabulary,
    hooksThatWork: jsonArray(row.hooksThatWork),
    hooksThatFlop: jsonArray(row.hooksThatFlop),
    claims: {
      allowed: jsonArray(row.allowedClaims),
      forbidden: jsonArray(row.forbiddenClaims),
      disclaimers: jsonArray(row.disclaimerClaims),
    },
    culturalNotes: row.culturalNotes,
  };
}
