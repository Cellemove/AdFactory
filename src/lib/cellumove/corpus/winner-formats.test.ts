import assert from "node:assert/strict";
import test from "node:test";
import { deriveWinnerFormats, WINNER_FORMAT_MIN_ADS, type WinnerFormatAd } from "./winner-formats";

const taxonomy = [
  { code: "H_PAIN", layer: "H", label: "Pain hook", description: "Open on the pain." },
  { code: "H_STORY", layer: "H", label: "Story hook", description: "Open on a story." },
  { code: "P_AGITATION", layer: "P", label: "Agitation", description: "Twist the knife." },
  { code: "M_DIFFERENCE", layer: "M", label: "Why it is different", description: "Contrast with the old way." },
  { code: "O_CTA", layer: "O", label: "Call to action", description: "Ask for the click." },
  { code: "PR_RARE", layer: "PR", label: "Rare proof", description: "Only a few ads do this." },
];

const ad = (index: number, over: Partial<WinnerFormatAd> = {}): WinnerFormatAd => ({
  id: `ad-${index}`, brand: "getionix.com", formatTag: "Voiceover", conceptTag: "New way vs old way", winnerScore: index,
  beats: [
    { code: "H_PAIN", layer: "H", orderIndex: 0, startSec: 0, endSec: 4, quote: `hook ${index}` },
    { code: "P_AGITATION", layer: "P", orderIndex: 1, startSec: 4, endSec: 14, quote: `agitate ${index}` },
    { code: "M_DIFFERENCE", layer: "M", orderIndex: 2, startSec: 14, endSec: 32, quote: `different ${index}` },
    // Only the first two ads carry the rare beat: well under the share bar.
    ...(index < 2 ? [{ code: "PR_RARE", layer: "PR", orderIndex: 3, startSec: 32, endSec: 36, quote: "rare" }] : []),
    { code: "O_CTA", layer: "O", orderIndex: 4, startSec: 36, endSec: 40, quote: `cta ${index}` },
  ],
  ...over,
});

test("a cohort of winners becomes a timed format in the order they actually run", () => {
  const formats = deriveWinnerFormats(Array.from({ length: WINNER_FORMAT_MIN_ADS }, (_, index) => ad(index)), taxonomy);
  const concept = formats.find((format) => format.slug === "winners-new-way-vs-old-way")!;
  assert.deepEqual(concept.beats.map((beat) => beat.label), ["Pain hook", "Agitation", "Why it is different", "Call to action"]);
  assert.deepEqual(concept.beats.map((beat) => beat.time), ["0–4s", "4–14s", "14–36s", "36–40s"]);
  assert.equal(concept.optimalDurationSec, 40);
  assert.equal(concept.adCount, WINNER_FORMAT_MIN_ADS);
  assert.match(concept.description, /Measured from 8 winning ads/);
  // The example comes from the highest-scoring winner, and is labelled as a reference.
  assert.match(concept.exampleScripts[0]!, /hook 7/);
  assert.match(concept.beats[0]!.note, /never to copy/);
  // The same winners also yield an opening-led format.
  assert.ok(formats.some((format) => format.slug === "winners-open-pain-hook"));
});

test("small cohorts and shapeless cohorts publish nothing", () => {
  assert.deepEqual(deriveWinnerFormats(Array.from({ length: WINNER_FORMAT_MIN_ADS - 1 }, (_, index) => ad(index)), taxonomy), []);
  const untagged = Array.from({ length: 10 }, (_, index) => ad(index, { conceptTag: null, beats: ad(index).beats.slice(0, 2) }));
  assert.deepEqual(deriveWinnerFormats(untagged, taxonomy), []);
});
