import assert from "node:assert/strict";
import test from "node:test";
import type { TaxonomyEntry } from "./extract";
import { beatLibrary, buildPlaybook, lawsFrom, spineFrom, type PlaybookAd } from "./playbook";
import type { CorpusPatternReportJson } from "./report";

const taxonomy: TaxonomyEntry[] = [
  { code: "H_PAIN", layer: "H", label: "Pain hook", description: "Opens on the pain." },
  { code: "P_HYPER_DATED", layer: "P", label: "Hyper-dated pain", description: "A dated moment." },
  { code: "M_QUANTIFIED", layer: "M", label: "Quantified mechanism", description: "How it works, with a number." },
  { code: "O_GUARANTEE", layer: "O", label: "Guarantee in the story's words", description: "Risk reversal." },
];

function ad(id: string, winnerScore: number, codes: Array<[string, string, string]>, extra: Partial<PlaybookAd> = {}): PlaybookAd {
  return {
    id, brand: "acme", winnerScore, formatTag: "UGC", angleTag: "Hidden cause", durationSec: 40,
    lines: [
      { adId: id, channel: "vo", tStart: 0, text: "Your knee wakes you at 3am." },
      { adId: id, channel: "ost", tStart: 0.5, text: "3AM. AGAIN." },
      { adId: id, channel: "vo", tStart: 12, text: "Twelve ridges press and release every step." },
    ],
    visuals: [{ tStart: 0, tEnd: 4, text: "Woman in bed grabbing her knee, dim light." }, { tStart: 10, tEnd: 16, text: "Cross-section animation of the leg." }],
    beats: codes.map(([layer, code, evidenceQuote], orderIndex) => ({ adId: id, orderIndex, layer, code, startSec: orderIndex * 10, endSec: orderIndex * 10 + 6, evidenceQuote, channel: "vo" })),
    ...extra,
  };
}

const ads: PlaybookAd[] = [
  ad("a", 90, [["H", "H_PAIN", "Your knee wakes you at 3am"], ["M", "M_QUANTIFIED", "Twelve ridges press and release"], ["O", "O_GUARANTEE", "you don't pay"]]),
  ad("b", 80, [["H", "H_PAIN", "Your knee wakes you at 3am"], ["M", "M_QUANTIFIED", "Twelve ridges press and release"], ["O", "O_GUARANTEE", "you don't pay"]]),
  ad("c", 70, [["P", "P_HYPER_DATED", "Week fourteen"], ["M", "M_QUANTIFIED", "Twelve ridges press and release"]], { formatTag: "Founder", angleTag: "Tried everything", visuals: [] }),
];

test("the beat library counts each code once per ad and attaches the on-screen text and the shot", () => {
  const library = beatLibrary(ads, taxonomy, { minSupport: 2, examplesPerBeat: 3 });
  const mechanism = library.find((beat) => beat.code === "M_QUANTIFIED")!;
  assert.equal(mechanism.ads, 3);
  assert.equal(mechanism.share, 1);
  assert.equal(mechanism.label, "Quantified mechanism");
  assert.equal(mechanism.medianStartSec, 10);
  assert.equal(mechanism.medianDurationSec, 6);
  assert.equal(mechanism.examples[0]?.adId, "a", "best-ranked ad first");
  assert.equal(mechanism.examples[0]?.visual, "Cross-section animation of the leg.");
  const hook = library.find((beat) => beat.code === "H_PAIN")!;
  assert.equal(hook.examples[0]?.onScreen, "3AM. AGAIN.");
  assert.equal(library.some((beat) => beat.code === "P_HYPER_DATED"), false, "one ad is below support");
});

const report = {
  sequences: { codeSpines: [{ pattern: ["H_PAIN", "M_QUANTIFIED", "O_GUARANTEE"], support: 2, share: 0.67, closed: true }], layerSpines: [] },
  positionalLaws: {
    layers: [{ x: "H", y: "O", support: 3, share: 1, law: true }],
    codes: [{ x: "H_PAIN", y: "O_GUARANTEE", support: 2, share: 1, law: true }, { x: "M_QUANTIFIED", y: "H_PAIN", support: 1, share: 0.3, law: false }],
  },
} as unknown as CorpusPatternReportJson;

test("the spine takes the mined sequence and gives each step the beat's typical window", () => {
  const library = beatLibrary(ads, taxonomy, { minSupport: 2, examplesPerBeat: 3 });
  const spine = spineFrom(report, library, ads.length)!;
  assert.deepEqual(spine.steps.map((step) => step.label), ["Pain hook", "Quantified mechanism", "Guarantee in the story's words"]);
  assert.deepEqual(spine.steps[1]!.window, [10, 16]);
  assert.equal(spine.ads, 2);
  assert.equal(spineFrom(null, library, 3), null);
});

test("laws are only the ones that hold, in plain words", () => {
  const laws = lawsFrom(report, taxonomy);
  assert.deepEqual(laws.map((law) => law.law), ["Hook comes before Offer", '"Pain hook" comes before "Guarantee in the story\'s words"']);
});

test("the playbook bundles everything and says what is thin", () => {
  const playbook = buildPlaybook({ brand: "acme", ads, taxonomy, report }, { taxonomyVersion: "copy-taxonomy-v2", minSupport: 2, now: new Date("2026-09-14T00:00:00Z") });
  assert.equal(playbook.adCount, 3);
  assert.equal(playbook.hooks.length, 1);
  assert.deepEqual(playbook.formats.map((row) => [row.name, row.ads]), [["UGC", 2], ["Founder", 1]]);
  assert.deepEqual(playbook.concepts[0], { name: "Hidden cause", ads: 2, share: 2 / 3 });
  assert.equal(playbook.medianDurationSec, 40);
  assert.ok(playbook.caveats.some((caveat) => caveat.startsWith("Only 3 ads")));
  assert.ok(playbook.caveats.some((caveat) => caveat.includes("visual direction")), "one ad has no visuals");
  assert.ok(!buildPlaybook({ brand: "acme", ads, taxonomy, report: null }, { taxonomyVersion: "v" }).spine);
});
