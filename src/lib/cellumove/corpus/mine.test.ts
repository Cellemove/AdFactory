import assert from "node:assert/strict";
import test from "node:test";
import { closedPatterns, cohortsOf, collapse, mineCorpus, percentile, positionalLaws, prefixSpan, type MinedAd } from "./mine";

const LAYER_OF: Record<string, string> = { H_OPENING: "H", P_PROBLEM: "P", M_MECHANISM: "M", PR_PROOF: "PR", O_CTA: "O" };

function ad(id: string, codes: string[], winnerScore: number | null, brand = "acme", durationSec: number | null = 30): MinedAd {
  const step = durationSec ? durationSec / codes.length : 5;
  return {
    id,
    brand,
    formatTag: "UGC",
    angleTag: null,
    winnerScore,
    durationSec,
    beats: codes.map((code, index) => ({ orderIndex: index, layer: LAYER_OF[code] ?? "OTHER", code, startSec: index * step, endSec: (index + 1) * step })),
  };
}

// 12 ads. Every ad opens with H_OPENING and closes with O_CTA; the planted spine
// H → P → O appears in 9; PR_PROOF appears only in the top-scoring ads.
const corpus: MinedAd[] = [
  ad("a1", ["H_OPENING", "P_PROBLEM", "PR_PROOF", "O_CTA"], 90),
  ad("a2", ["H_OPENING", "P_PROBLEM", "PR_PROOF", "O_CTA"], 85),
  ad("a3", ["H_OPENING", "P_PROBLEM", "M_MECHANISM", "PR_PROOF", "O_CTA"], 80),
  ad("a4", ["H_OPENING", "P_PROBLEM", "O_CTA"], 60),
  ad("a5", ["H_OPENING", "P_PROBLEM", "O_CTA"], 55),
  ad("a6", ["H_OPENING", "M_MECHANISM", "P_PROBLEM", "O_CTA"], 50, "other"),
  ad("a7", ["H_OPENING", "P_PROBLEM", "O_CTA"], 45, "other"),
  ad("a8", ["H_OPENING", "P_PROBLEM", "O_CTA"], 40, "other"),
  ad("a9", ["H_OPENING", "P_PROBLEM", "O_CTA"], 30, "other"),
  ad("a10", ["H_OPENING", "M_MECHANISM", "O_CTA"], 20, "other"),
  ad("a11", ["H_OPENING", "O_CTA"], 10, "other", null),
  ad("a12", ["H_OPENING", "M_MECHANISM", "O_CTA"], 5, "other"),
];

const options = { taxonomyVersion: "copy-taxonomy-v1", engineVersion: "test", cohort: "all", cohortKey: "all", minSupport: 5, now: new Date("2026-09-10T00:00:00Z") };

test("collapse removes consecutive duplicates only", () => {
  assert.deepEqual(collapse(["H", "H", "P", "P", "H"]), ["H", "P", "H"]);
});

test("percentile interpolates", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10], 0.75), 10);
  assert.equal(percentile([], 0.5), null);
});

test("code frequency shares are exact", () => {
  const report = mineCorpus(corpus, options);
  const opening = report.codeFrequency.find((row) => row.code === "H_OPENING")!;
  assert.equal(opening.ads, 12);
  assert.equal(opening.adShare, 1);
  assert.equal(opening.medianRelPosition, 0);
  const proof = report.codeFrequency.find((row) => row.code === "PR_PROOF")!;
  assert.equal(proof.ads, 3);
  assert.equal(proof.adShare, 0.25);
});

test("positional laws: 100% is a law, 90% is not, thin support is excluded", () => {
  const sequences = corpus.map((item) => collapse(item.beats.map((beat) => beat.code)));
  const laws = positionalLaws(sequences, 5, 0.95);
  const hThenO = laws.find((row) => row.x === "H_OPENING" && row.y === "O_CTA")!;
  assert.equal(hThenO.share, 1);
  assert.equal(hThenO.law, true);
  const mThenP = laws.find((row) => row.x === "M_MECHANISM" && row.y === "P_PROBLEM");
  assert.equal(mThenP, undefined, "M/P co-occur in only 2 ads, below minSupport");
  const nearLaw = positionalLaws([["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["B", "A"]], 5, 0.95).find((row) => row.x === "A" && row.y === "B")!;
  assert.equal(nearLaw.share, 0.9);
  assert.equal(nearLaw.law, false);
});

test("PrefixSpan finds the planted spine with exact support and marks it closed", () => {
  const sequences = corpus.map((item) => collapse(item.beats.map((beat) => beat.code)));
  const patterns = closedPatterns(prefixSpan(sequences, 3, 6));
  const spine = patterns.find((row) => row.pattern.join(",") === "H_OPENING,P_PROBLEM,O_CTA")!;
  assert.equal(spine.support, 9);
  assert.equal(spine.closed, true);
  const hp = patterns.find((row) => row.pattern.join(",") === "H_OPENING,P_PROBLEM")!;
  assert.equal(hp.support, 9);
  assert.equal(hp.closed, false, "H,P has the same support as H,P,O so it is not closed");
});

test("lift separates the top-quartile-only code and needs eight scored ads", () => {
  const report = mineCorpus(corpus, options);
  assert.equal(report.lift.status, "scored");
  const proof = report.lift.codes.find((row) => row.key === "PR_PROOF")!;
  assert.ok(proof.pTop > proof.pBottom);
  assert.ok(proof.lift > 1);
  const small = mineCorpus(corpus.slice(0, 6), options);
  assert.equal(small.lift.status, "insufficient");
  assert.ok(small.caveats.some((caveat) => /Lift needs/.test(caveat)));
});

test("layer durations highlight M and exclude ads without a duration", () => {
  const report = mineCorpus(corpus, options);
  assert.equal(report.layerDurations.adsWithDuration, 11);
  const mechanism = report.layerDurations.rows.find((row) => row.layer === "M")!;
  assert.equal(mechanism.highlight, true);
  assert.equal(report.layerDurations.rows.filter((row) => row.highlight).length, 1);
  assert.ok(report.caveats.some((caveat) => /no known duration/.test(caveat)));
});

test("a brand over the share cap is flagged; cohorts respect min support", () => {
  const report = mineCorpus(corpus, options);
  assert.ok(report.caveats.some((caveat) => /^other contributes/.test(caveat)));
  const cohorts = cohortsOf(corpus, 5);
  assert.deepEqual(cohorts.map((cohort) => `${cohort.cohort}:${cohort.cohortKey}`), ["all:all", "format:UGC", "brand:other", "brand:acme"]);
});
