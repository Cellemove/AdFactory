// Backtest: how much ROAS signal is in creative similarity?
//
// Method: embed every enriched winner (headline + primary text + visual concept +
// hook + angle), hold out 20%, and predict each holdout ad's ROAS as the
// spend-weighted median of its k nearest TRAINING winners (cosine similarity).
// Compare predictions to actual ROAS.
//
// Metrics:
//   • Spearman rank correlation (does predicted order match real order?)
//   • MAE vs "always predict the median" baselines (global / per-market)
//   • Top-decile lift: mean actual ROAS of the 10% we'd rank first vs holdout mean
//     — the number that matters for "which scripts should we test first."
//
// Honest caveat baked in: the data is winners-only (ROAS ≥ 1.8), so this measures
// within-winner signal — a lower bound on winners-vs-losers separability.
//
// Run: npx tsx --env-file=.env scripts/backtest-roas-similarity.ts

import { supabase } from "../src/lib/db";
import { embedTexts, cosine } from "../src/lib/cellumove/embeddings";
import type { SheetWinner, SheetWinnersDoc } from "../src/lib/cellumove/sheet-winners";

const HOLDOUT = 0.2;
const SEED = 42;

// Deterministic RNG so the split is reproducible run-to-run.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function repText(w: SheetWinner): string {
  const e = w.enrichment!;
  return [
    w.angle ? `angle: ${w.angle}` : "",
    e.hookType ? `hook: ${e.hookType}` : "",
    e.funnel ? `funnel: ${e.funnel}` : "",
    e.headline,
    e.primaryText,
    e.visualConcept,
  ]
    .filter(Boolean)
    .join(" | ");
}

function spendWeightedMedian(items: { roas: number; spend: number }[]): number {
  const sorted = [...items].sort((a, b) => a.roas - b.roas);
  const total = sorted.reduce((s, x) => s + x.spend, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.spend;
    if (acc >= total / 2) return x.roas;
  }
  return sorted[sorted.length - 1]?.roas ?? 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

// Spearman rank correlation with average ranks for ties.
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const ranks = new Array<number>(xs.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k]![1]] = r;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = ra[i]! - ma;
    const xb = rb[i]! - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

async function main() {
  const r = await supabase.from("Research").select("drafts").eq("type", "sheet_winners").limit(1).maybeSingle();
  if (r.error || !r.data) throw new Error("No imported winners.");
  const doc = JSON.parse((r.data as { drafts: string }).drafts) as SheetWinnersDoc;
  const all = doc.winners.filter((w) => w.enrichment);
  console.log(`enriched winners: ${all.length}`);

  console.log("embedding…");
  const embs = await embedTexts(all.map(repText));
  if (!embs) throw new Error("Embedding failed (creds/quota).");

  // Reproducible shuffle → 80/20 split.
  const rng = mulberry32(SEED);
  const order = all.map((_, i) => i).sort(() => rng() - 0.5);
  const nTest = Math.floor(all.length * HOLDOUT);
  const testIdx = new Set(order.slice(0, nTest));
  const train = order.slice(nTest);
  console.log(`train=${train.length} test=${nTest}`);

  const predict = (i: number, k: number, sameMarketOnly: boolean): number => {
    const sims: { j: number; sim: number }[] = [];
    for (const j of train) {
      if (sameMarketOnly && all[j]!.market !== all[i]!.market) continue;
      sims.push({ j, sim: cosine(embs[i]!, embs[j]!) });
    }
    sims.sort((a, b) => b.sim - a.sim);
    const top = sims.slice(0, k);
    if (!top.length) return NaN;
    return spendWeightedMedian(top.map(({ j }) => ({ roas: all[j]!.roas, spend: all[j]!.spend })));
  };

  const actual = [...testIdx].map((i) => all[i]!.roas);
  const trainMedian = median(train.map((j) => all[j]!.roas));
  const marketMedian = new Map<string, number>();
  for (const m of new Set(train.map((j) => all[j]!.market))) {
    marketMedian.set(m, median(train.filter((j) => all[j]!.market === m).map((j) => all[j]!.roas)));
  }

  for (const [label, k, marketOnly] of [
    ["global kNN k=10", 10, false],
    ["global kNN k=5", 5, false],
    ["global kNN k=20", 20, false],
    ["same-market kNN k=10", 10, true],
  ] as const) {
    const preds = [...testIdx].map((i) => predict(i, k, marketOnly));
    const ok = preds.every((p) => Number.isFinite(p));
    const rho = spearman(preds, actual);
    const mae = preds.reduce((s, p, x) => s + Math.abs(p - actual[x]!), 0) / preds.length;
    // Top/bottom decile by prediction → mean ACTUAL roas
    const ranked = [...testIdx].map((i, x) => ({ i, pred: preds[x]!, act: actual[x]! })).sort((a, b) => b.pred - a.pred);
    const dec = Math.max(1, Math.floor(ranked.length / 10));
    const topMean = ranked.slice(0, dec).reduce((s, x) => s + x.act, 0) / dec;
    const botMean = ranked.slice(-dec).reduce((s, x) => s + x.act, 0) / dec;
    const allMean = actual.reduce((s, x) => s + x, 0) / actual.length;
    console.log(
      `\n${label}${ok ? "" : " (some NaN)"}\n  Spearman ρ = ${rho.toFixed(3)} · MAE = ${mae.toFixed(3)}\n  holdout mean ROAS ${allMean.toFixed(2)} · top-decile-by-pred ${topMean.toFixed(2)} (${((topMean / allMean - 1) * 100).toFixed(0)}% lift) · bottom-decile ${botMean.toFixed(2)}`,
    );
  }

  // Baselines
  const gPreds = actual.map(() => trainMedian);
  const gMae = gPreds.reduce((s, p, x) => s + Math.abs(p - actual[x]!), 0) / gPreds.length;
  const mPreds = [...testIdx].map((i) => marketMedian.get(all[i]!.market) ?? trainMedian);
  const mMae = mPreds.reduce((s, p, x) => s + Math.abs(p - actual[x]!), 0) / mPreds.length;
  const mRho = spearman(mPreds, actual);
  console.log(`\nbaseline "global median always": MAE = ${gMae.toFixed(3)} (ρ undefined)`);
  console.log(`baseline "market median":        MAE = ${mMae.toFixed(3)} · Spearman ρ = ${mRho.toFixed(3)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
