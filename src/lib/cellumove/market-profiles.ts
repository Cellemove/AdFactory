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
