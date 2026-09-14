import assert from "node:assert/strict";
import test from "node:test";
import { copyProfile, copyRules, signatureWords, toneStats, type CopyAd } from "./copy-rules";

function ad(id: string, winnerScore: number, vo: string[], ost: string[], beats: Array<[string, string, string]>): CopyAd {
  return {
    id,
    winnerScore,
    lines: [
      ...vo.map((text, index) => ({ adId: id, channel: "vo" as const, tStart: index * 4, text })),
      ...ost.map((text, index) => ({ adId: id, channel: "ost" as const, tStart: index * 4 + 0.5, text })),
    ],
    beats: beats.map(([layer, code, evidenceQuote], orderIndex) => ({ adId: id, orderIndex, layer, code, startSec: orderIndex * 5, evidenceQuote })),
  };
}

// Four ads in one house style: pain first, "you", failed alternatives, a number
// in the proof, a clean guarantee, a soft CTA — and one that swears elsewhere.
const brand: CopyAd[] = [
  ad("a", 90, ["It's 3am and your knee wakes you up again.", "You tried the creams. The brace slips by lunch.", "Over 37,000 people sleep through the night.", "If it doesn't work you don't pay. See why thousands switched."], ["3AM. AGAIN.", "NO CREAMS. NO BRACES."],
    [["H", "H_PAIN", "It's 3am and your knee wakes you up again"], ["B", "B_FAILED_ALTERNATIVES", "You tried the creams. The brace slips by lunch"], ["PR", "PR_SOCIAL_NUMBERS", "Over 37,000 people sleep through the night"], ["O", "O_GUARANTEE", "If it doesn't work you don't pay"]]),
  ad("b", 80, ["Week fourteen. Forty pounds gone and your thighs are fucking hanging.", "Cream never gets past the top layer.", "100,000 women wear these.", "Wear them thirty days. If they don't come down, you don't pay a dollar. Find out how."], ["WEEK 14. -40 LBS."],
    [["P", "P_HYPER_DATED", "Week fourteen. Forty pounds gone"], ["B", "B_FAILED_ALTERNATIVES", "Cream never gets past the top layer"], ["PR", "PR_SOCIAL_NUMBERS", "100,000 women wear these"], ["O", "O_GUARANTEE", "If they don't come down, you don't pay a dollar"]]),
  ad("c", 70, ["Your legs feel heavy by 3pm.", "Pills did nothing for you.", "4.3 stars on Trustpilot.", "Try them for ninety days, love them or it's free."], ["HEAVY LEGS BY 3PM"],
    [["H", "H_PAIN", "Your legs feel heavy by 3pm"], ["B", "B_FAILED_ALTERNATIVES", "Pills did nothing for you"], ["PR", "PR_SOCIAL_NUMBERS", "4.3 stars on Trustpilot"], ["O", "O_GUARANTEE", "love them or it's free"]]),
  ad("d", 60, ["Nobody tells you this about your back.", "Shapewear rolls down and cuts a line.", "12,000 five-star reviews.", "Shop now."], ["Nobody tells you this"],
    [["H", "H_CURIOSITY", "Nobody tells you this about your back"], ["B", "B_FAILED_ALTERNATIVES", "Shapewear rolls down and cuts a line"], ["PR", "PR_SOCIAL_NUMBERS", "12,000 five-star reviews"], ["O", "O_CTA", "Shop now"]]),
];

test("rules are counted per ad, ordered by how often the brand follows them, with proofs from the best ads first", () => {
  const rules = copyRules(brand, { minSupport: 2, minShare: 0.5 });
  const byKey = new Map(rules.map((rule) => [rule.key, rule]));
  assert.equal(byKey.get("failed-alternatives")?.ads, 4);
  assert.equal(byKey.get("failed-alternatives")?.share, 1);
  assert.equal(byKey.get("number-in-proof")?.ads, 4);
  assert.equal(byKey.get("second-person")?.ads, 4);
  assert.equal(byKey.get("opens-on-pain")?.ads, 3, "the curiosity opener does not count");
  assert.equal(byKey.get("guarantee")?.ads, 3);
  assert.equal(byKey.get("failed-alternatives")?.examples[0]?.adId, "a", "best-ranked ad is quoted first");
  assert.equal(byKey.get("failed-alternatives")?.examples.length, 3);
  assert.ok(rules[0]!.share >= rules[rules.length - 1]!.share);
});

test("rules below the support or share floor are left out", () => {
  const rules = copyRules(brand, { minSupport: 2, minShare: 0.5 });
  const keys = rules.map((rule) => rule.key);
  assert.ok(!keys.includes("swears"), "one swearing ad out of four is not a rule");
  assert.ok(!keys.includes("hard-cta"), "one 'shop now' is not a rule");
  assert.ok(!keys.includes("clean-guarantee"), "needs the swearing ads to have guarantees to compare");
});

test("tone stats describe how the brand writes", () => {
  const tone = toneStats(brand);
  const byKey = new Map(tone.map((stat) => [stat.key, stat]));
  assert.match(byKey.get("person")!.value, /^"you"/);
  assert.equal(byKey.get("question")!.value, "0% of ads");
  assert.match(byKey.get("caption")!.note!, /ALL CAPS/);
  assert.match(byKey.get("sentence")!.value, /words$/);
});

test("signature words are content words shared across ads, never stopwords", () => {
  const words = signatureWords(brand, { minShare: 0.5 });
  const terms = words.map((word) => word.term);
  assert.ok(terms.includes("thousand") || terms.includes("don't") || terms.length > 0);
  assert.ok(!terms.includes("the") && !terms.includes("your"), "stopwords excluded");
  assert.ok(words.every((word) => word.ads >= 2));
});

test("the profile bundles tone, rules and vocabulary for one brand", () => {
  const profile = copyProfile(brand, { minSupport: 2 });
  assert.equal(profile.adCount, 4);
  assert.ok(profile.rules.length >= 4);
  assert.ok(profile.tone.length >= 4);
  assert.deepEqual(copyProfile([], {}).rules, []);
});
