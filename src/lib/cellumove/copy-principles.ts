// Seed payload for CopyPrinciple table.
// Categories: "iteration" | "big_swing" | "kill" | "writing".

export interface PrincipleSeed {
  slug: string;
  category: "iteration" | "big_swing" | "kill" | "writing";
  title: string;
  body: string;
  order: number;
}

export const COPY_PRINCIPLES: PrincipleSeed[] = [
  // ── Iteration ───────────────────────────────────────────────────────────
  {
    slug: "iterate-one-variable",
    category: "iteration",
    title: "Iterate one variable at a time",
    body: "If you change two things at once and performance moves, you don't know which one moved it. Pick ONE: hook, headline, visual, or CTA. Hold the rest constant.",
    order: 1,
  },
  {
    slug: "iterate-from-winners-only",
    category: "iteration",
    title: "Iterate from winners only",
    body: "An iteration off a flat-performing ad is a coin flip with extra steps. Iterate from ads that already cleared the spend bar.",
    order: 2,
  },
  {
    slug: "iterate-name-canonically",
    category: "iteration",
    title: "Use the canonical iteration name",
    body: "Format: IT[N]-[LEVEL]-[EDITOR]-[ORIGINAL_AD_NAME]-[HOOK]. Editor is MO, VA, or DO — never SU. Level is easy, medium, or hard.",
    order: 3,
  },

  // ── Big Swing ────────────────────────────────────────────────────────────
  {
    slug: "bigswing-explore-not-tweak",
    category: "big_swing",
    title: "Big Swings explore, they don't tweak",
    body: "A Big Swing is a new format, hook mechanic, or framing — not a recolor. If a teammate can't tell you swung, you didn't.",
    order: 1,
  },
  {
    slug: "bigswing-budget-discipline",
    category: "big_swing",
    title: "Cap Big Swing spend per concept",
    body: "Decide the kill threshold BEFORE you ship. A Big Swing that consumes iteration budget is a tax, not a bet.",
    order: 2,
  },
  {
    slug: "bigswing-one-hook-mechanic",
    category: "big_swing",
    title: "One hook mechanic per concept",
    body: "Pick one of the 12 mechanics and commit. Stacked mechanics dilute attribution and confuse the reader.",
    order: 3,
  },

  // ── Kill Criteria ────────────────────────────────────────────────────────
  {
    slug: "kill-spend-floor",
    category: "kill",
    title: "Kill at spend floor without performance signal",
    body: "If an ad has spent $50 without a single purchase and CPC is above target, kill it. Do not 'give it more time'.",
    order: 1,
  },
  {
    slug: "kill-cpa-3x-target",
    category: "kill",
    title: "Kill at 3× target CPA after 100 clicks",
    body: "Statistical floor: 100 link clicks is enough signal to call it. CPA at 3× target is a structural mismatch, not a tuning problem.",
    order: 2,
  },
  {
    slug: "kill-ctr-collapse",
    category: "kill",
    title: "Kill on CTR collapse versus angle baseline",
    body: "If an ad's CTR is below 50% of the angle's rolling baseline for 48h after $20 spent, it's a hook failure. Kill.",
    order: 3,
  },
  {
    slug: "kill-iterate-the-killer-not-the-corpse",
    category: "kill",
    title: "Iterate the killer, not the corpse",
    body: "When you kill an ad, the next test should iterate from the WINNER in the same angle — not from the dead one. Losers don't earn iteration slots.",
    order: 4,
  },

  // ── Writing ──────────────────────────────────────────────────────────────
  {
    slug: "writing-no-cure-language",
    category: "writing",
    title: "No cure language",
    body: "fix, cure, eliminate, remove, get rid of permanently, Day 1 results, instant fix → BLOCK. Compression supports; it does not cure.",
    order: 1,
  },
  {
    slug: "writing-headline-is-a-contract",
    category: "writing",
    title: "The exact headline is a contract",
    body: "The engine inserts line breaks only. If you 'improve' a headline, you broke the contract. Hand-edit the brief instead.",
    order: 2,
  },
  {
    slug: "writing-show-mechanism-non-literally",
    category: "writing",
    title: "Show the mechanism, never the literal hook",
    body: "No clocks for time hooks. No oranges for orange peel. No calendars for durations. No flames for calories.",
    order: 3,
  },
];
