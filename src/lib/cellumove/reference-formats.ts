// Seed payload for the ReferenceFormat table — SCRIPT structures (Module 5).
// These are distinct from the VISUAL Big-Swing formats in formats.ts: a
// reference format is the timed beat-skeleton the Script Generator fills in.
// Start with the 5 patterns already identified; enrich over time with winners.

export interface ReferenceFormatBeat {
  label: string;   // "Dream Outcome", "Why Not Me", …
  time: string;    // "0–3s"
  note: string;    // what this beat must accomplish
}

export interface ReferenceFormatSeed {
  slug: string;
  name: string;
  description: string;
  beats: ReferenceFormatBeat[];
  bestForAngle: string;          // type of angle this format works best with
  optimalDurationSec: number;
  exampleScripts: string[];      // winner scripts — fill in from real winners
  order: number;
}

export const REFERENCE_FORMATS: ReferenceFormatSeed[] = [
  {
    slug: "magic-formula",
    name: "Magic Formula",
    description: "Lead with the dream outcome, dissolve the 'why not me' objection, prove it, then a warm offer.",
    beats: [
      { label: "Dream Outcome", time: "0–3s", note: "Open on the after-state the avatar most wants — concrete, visual, specific." },
      { label: "Why Not Me", time: "3–8s", note: "Name the belief that's been keeping them out ('I've tried everything')." },
      { label: "Proof", time: "8–20s", note: "Show the mechanism + real proof — never just told, shown on screen." },
      { label: "CTA", time: "20–30s", note: "Warm, low-pressure offer from the allowed-CTA list." },
    ],
    bestForAngle: "Aspirational / desire-led angles where the after-state is vivid.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 1,
  },
  {
    slug: "regret-arc",
    name: "Regret Arc",
    description: "Confess the cost of waiting, walk the turning point, land on relief — regret converted to motion.",
    beats: [
      { label: "The Regret", time: "0–3s", note: "A specific thing they stopped doing / years lost ('I haven't worn shorts in 4 years')." },
      { label: "The Spiral", time: "3–10s", note: "How the avoidance compounded — the quiet daily toll." },
      { label: "Turning Point", time: "10–20s", note: "What changed — the mechanism that finally made it different." },
      { label: "Relief + CTA", time: "20–30s", note: "The reclaimed moment, then a gentle invitation." },
    ],
    bestForAngle: "Shame / avoidance angles (Lipoedema, Quietly-Suffering).",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 2,
  },
  {
    slug: "behavior-change",
    name: "Behavior Change",
    description: "One small swap reframed as the lever — the 'I changed one thing' structure.",
    beats: [
      { label: "The One Change", time: "0–3s", note: "'The only thing I changed was…' — single, concrete swap." },
      { label: "Old Way vs New Way", time: "3–12s", note: "Contrast the old routine's friction with the new ease." },
      { label: "Mechanism", time: "12–22s", note: "Why the swap works — the angle's mechanism, plainly." },
      { label: "CTA", time: "22–30s", note: "Invite them to make the same swap." },
    ],
    bestForAngle: "Habit / effortlessness angles (Heavy Legs, end-of-day relief).",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 3,
  },
  {
    slug: "comparison-detox",
    name: "Comparison Detox",
    description: "Quietly dismantle the category's broken promises, then position the product as the honest alternative.",
    beats: [
      { label: "The Frustration", time: "0–4s", note: "'Other leggings promised X and…' — the category's broken promise." },
      { label: "Why They Fail", time: "4–14s", note: "The structural reason the usual options don't work — no named competitor." },
      { label: "The Honest Alternative", time: "14–24s", note: "What we do differently, including what we DON'T claim (skeptic trust)." },
      { label: "CTA", time: "24–30s", note: "Low-risk offer for the burned-before buyer." },
    ],
    bestForAngle: "Skeptic / tried-everything audiences, BOFU.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 4,
  },
  {
    slug: "texture-test",
    name: "Texture Test",
    description: "A satisfying, tactile on-screen demonstration carries the whole ad — show, barely tell.",
    beats: [
      { label: "The Test", time: "0–3s", note: "Start mid-demonstration — the satisfying tactile moment that stops the scroll." },
      { label: "The Reaction", time: "3–10s", note: "Honest reaction to what they feel/see — relatable, unscripted feel." },
      { label: "Why It Works", time: "10–20s", note: "Tie the sensation to the mechanism, briefly." },
      { label: "CTA", time: "20–30s", note: "Invite them to feel it themselves." },
    ],
    bestForAngle: "Demo-friendly angles where the product's feel is the proof.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 5,
  },
];
