// Taxonomy seeds for "CopyTaxonomyCode". Seeded by scripts/seed-copy-taxonomy.ts.
//
// Rules (spec §4): the model selects from a CLOSED enum and never invents;
// every layer has an OTHER code with mandatory free text; a taxonomy is never
// mutated in place — changes are a new version, or old beats stop being
// interpretable. Seeds live in a .ts file because .gitignore drops
// *-*-*.json files.
//
// copy-taxonomy-v1 (migration 015) is the nine-code placeholder the first runs
// used. copy-taxonomy-v2 below is built from the strategist's own script board
// (SU0900002IO): its named beats — hyper-dated pain, reattribution, category
// execution, quantified mechanism, skepticism inoculation, time ladder,
// witness, guarantee in the story's words, offer with a reason-why — plus the
// hook types the Teardown workbook classifies by. Descriptions are written
// for the extractor: they say what the beat DOES, with a recognisable example.
//
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2           (dry run, prints the diff)
//   npm run miner:seed-taxonomy -- --version copy-taxonomy-v2 --commit
// The seed script appends the per-layer OTHER codes automatically.

import type { ScorerLayer } from "@/lib/cellumove/script-scorer";

export type TaxonomySeed = {
  code: string;
  layer: ScorerLayer;
  label: string;
  description: string;
};

export const TAXONOMY_LAYERS: Array<{ layer: Exclude<ScorerLayer, "OTHER">; name: string }> = [
  { layer: "H", name: "Hook" },
  { layer: "Q", name: "Qualify" },
  { layer: "P", name: "Pain" },
  { layer: "B", name: "Belief" },
  { layer: "M", name: "Mechanism" },
  { layer: "PR", name: "Proof" },
  { layer: "O", name: "Offer" },
];

/** One OTHER code per layer (H_OTHER, Q_OTHER, …) plus the global OTHER. */
export function perLayerOtherCodes(): TaxonomySeed[] {
  return [
    ...TAXONOMY_LAYERS.map(({ layer, name }) => ({
      code: `${layer}_OTHER`,
      layer,
      label: `Other ${name.toLowerCase()} beat`,
      description: `A ${name.toLowerCase()}-layer beat that fits none of the named ${name.toLowerCase()} codes. other_explanation is mandatory; recurring explanations are promoted to real codes in the next taxonomy version.`,
    })),
    { code: "OTHER", layer: "OTHER", label: "Other", description: "A deliberate beat that belongs to no layer. other_explanation is mandatory." },
  ];
}

const HOOKS: TaxonomySeed[] = [
  { code: "H_QUESTION", layer: "H", label: "Question hook", description: "Opens by asking the viewer a direct question they feel they must answer. Example: \"What happens to a woman's legs on Ozempic if she puts these on before she's done losing the weight?\"" },
  { code: "H_BOLD_CLAIM", layer: "H", label: "Bold claim hook", description: "Opens with a shocking, absolute or surprising statement or promise, stated as fact. Example: \"This box will be illegal in about two weeks.\"" },
  { code: "H_STORY", layer: "H", label: "Story hook", description: "Opens inside a person's story or moment, told as narrative (a name, a time, a place) before any product. Example: \"Anna and Sylvie. Same week. Same dose.\"" },
  { code: "H_DEMO", layer: "H", label: "Demo hook", description: "Opens by showing the product or result working on screen before explaining anything; the visual proof IS the hook." },
  { code: "H_SOCIAL_PROOF", layer: "H", label: "Social-proof hook", description: "Opens with how many people bought, rated or switched, or a testimonial line, as the first thing said or shown." },
  { code: "H_AUTHORITY", layer: "H", label: "Authority hook", description: "Opens with a doctor, expert, study or credential speaking or cited, before the problem or product." },
  { code: "H_PAIN", layer: "H", label: "Pain hook", description: "Opens by naming the viewer's problem or symptom straight away, in their words. Example: \"Heavy legs by 3pm?\"" },
  { code: "H_CURIOSITY", layer: "H", label: "Curiosity hook", description: "Opens by withholding: hints at one thing, a secret, or what happens next, without saying what it is. Example: \"One of them changed one thing.\"" },
  { code: "H_PATTERN_INTERRUPT", layer: "H", label: "Pattern-interrupt hook", description: "Opens with something out of place for the feed: an odd image, glitch, unexpected object or line whose only job is to stop the scroll." },
  { code: "H_CALLOUT", layer: "H", label: "Callout hook", description: "Opens by naming an enemy, a controversy or a confrontation: an industry, a competitor, a common practice. Example: \"Big skincare came after us.\"" },
  { code: "H_CONTRAST", layer: "H", label: "Contrast hook", description: "Opens on a side-by-side: two people, two outcomes, before vs after, or the same thing shown twice with one difference. Example: split screen, \"same weight, same shot, different legs\"." },
];

const QUALIFY: TaxonomySeed[] = [
  { code: "Q_CALLOUT", layer: "Q", label: "Names the viewer", description: "Says who this is for so the right person leans in: an age, a situation, a condition, a stage. Example: \"If you're on the shots and losing fast…\"" },
  { code: "Q_EXCLUSION", layer: "Q", label: "Rules out who it is not for", description: "Says who should keep scrolling, or what this is NOT (not a pill, not another cream), to sharpen who stays." },
];

const PAIN: TaxonomySeed[] = [
  { code: "P_HYPER_DATED", layer: "P", label: "Hyper-dated pain", description: "The pain as one specific, dated, numbered moment rather than a general complaint: a time of day, a week number, a weight, a place, a gesture. Example: \"Week fourteen. Forty pounds gone. Nine at night, she's in the bathroom pinching the inside of her knee.\"" },
  { code: "P_AGITATION", layer: "P", label: "Agitation", description: "Makes the pain bigger: what it leads to, what it will cost, the future if nothing changes. Example: \"It doesn't go back. It never does.\"" },
  { code: "P_SOCIAL", layer: "P", label: "Social / identity pain", description: "The pain of being seen, judged or hiding: covering up, avoiding photos, what others think. Example: \"85 pounds down and she still covers up.\"" },
  { code: "P_COST", layer: "P", label: "Wasted money or time", description: "The pain of what has already been spent or tried without result: money, months, effort. Example: \"the creams are in the bin.\"" },
];

const BELIEF: TaxonomySeed[] = [
  { code: "B_REATTRIBUTION", layer: "B", label: "Reattribution", description: "Moves the blame: the real cause is X, not what the viewer assumed. Example: \"That's not a skin problem. That's a blood-flow problem.\"" },
  { code: "B_FAILED_ALTERNATIVES", layer: "B", label: "Category execution", description: "Names the things people usually try and dismisses each with a reason it fails: creams, shapewear, surgery, pills. Example: \"$60 a jar. $12,000 and a knife.\"" },
  { code: "B_MYTH_BUST", layer: "B", label: "Myth bust", description: "Challenges advice or a belief the viewer holds as true: what doctors say, what everyone does, what the category promises." },
  { code: "B_SKEPTICISM_INOCULATION", layer: "B", label: "Skepticism inoculation", description: "Voices the viewer's doubt before they can, and accepts it. Example: \"Week one, nothing. She's not convinced. That's fair.\"" },
  { code: "B_IDENTITY", layer: "B", label: "Identity reframe", description: "Tells the viewer who they are or what they deserve, so buying fits the person they see themselves as. Example: \"You did the hardest part.\"" },
];

const MECHANISM: TaxonomySeed[] = [
  { code: "M_QUANTIFIED", layer: "M", label: "Quantified mechanism", description: "How it works, with a number or a concrete physical action. Example: \"[N] raised ridges. Every step, they press into her leg and let go. Press, release.\"" },
  { code: "M_VISUAL", layer: "M", label: "Visual mechanism", description: "The mechanism shown rather than said: a cross-section, animation, x-ray, layers, arrows. Use when the explanation is carried by the picture." },
  { code: "M_MATERIAL", layer: "M", label: "Material or ingredient", description: "What it is made of or contains, as the reason it works. Example: \"100% pure cotton, biodegradable, single-use towels.\"" },
  { code: "M_EFFORTLESS", layer: "M", label: "Effortless use", description: "What the user does — or does not have to do — for it to work. Example: \"She isn't doing anything. She's walking to the car.\"" },
  { code: "M_DIFFERENCE", layer: "M", label: "What makes it different", description: "The one thing this does that the rest of the category does not; the unique mechanism stated as a difference." },
];

const PROOF: TaxonomySeed[] = [
  { code: "PR_TIME_LADDER", layer: "PR", label: "Time ladder", description: "Results laid out at successive times. Example: \"Week three, the crease is shallower. Day thirty… Day ninety, she's at her goal.\"" },
  { code: "PR_WITNESS", layer: "PR", label: "Witness", description: "Someone other than the buyer notices the change. Example: \"Her sister asked what she changed at the gym.\"" },
  { code: "PR_RAW_CUSTOMER", layer: "PR", label: "Raw customer footage", description: "Real customers shown as-is, and said to be real: phone footage, same angle, dated shots. Example: \"This part is not animation. Real customers, same angle, same light.\"" },
  { code: "PR_SOCIAL_NUMBERS", layer: "PR", label: "Numbers of people", description: "How many bought, rated or joined, or that it sold out. Example: \"100,000 women. 4.3 stars on Trustpilot.\"" },
  { code: "PR_AUTHORITY", layer: "PR", label: "Authority proof", description: "A doctor, expert, study, certification or award vouching for it." },
  { code: "PR_BEFORE_AFTER", layer: "PR", label: "Before and after", description: "An explicit before-vs-after comparison of the same person or thing." },
  { code: "PR_DEMO", layer: "PR", label: "Demonstration", description: "The product shown doing what is claimed, as proof rather than as an explanation of how." },
];

const OFFER: TaxonomySeed[] = [
  { code: "O_GUARANTEE", layer: "O", label: "Guarantee in the story's words", description: "The risk reversal, said plainly and inside the story. Example: \"If her thighs don't come down with the rest of her, she doesn't pay a dollar.\"" },
  { code: "O_REASON_WHY", layer: "O", label: "Offer with a reason-why", description: "A deal with the reason it exists. Example: \"Buy one, second one free. Not generosity. She's dropping a size before day ninety.\"" },
  { code: "O_PRICE", layer: "O", label: "Price or discount", description: "The price, a discount, a bundle or a saving, stated as such." },
  { code: "O_URGENCY", layer: "O", label: "Urgency or scarcity", description: "A reason to act now: limited stock, a deadline, sold out before. Example: \"Illegal in two weeks.\"" },
  { code: "O_CTA", layer: "O", label: "Call to action", description: "The instruction to act: tap, shop, order, see why, find out how." },
  { code: "O_CLOSING_LINE", layer: "O", label: "Closing line", description: "The last emotional line that ties the offer back to the story or identity. Example: \"Don't finish this with legs she has to cover.\"" },
];

export const TAXONOMY_SEEDS: Record<string, TaxonomySeed[]> = {
  "copy-taxonomy-v2": [...HOOKS, ...QUALIFY, ...PAIN, ...BELIEF, ...MECHANISM, ...PROOF, ...OFFER],
};
