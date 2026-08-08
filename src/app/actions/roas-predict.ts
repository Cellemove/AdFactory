"use server";

// Similar-winners ROAS estimate for pipeline-generated scripts (G6).
//
// Method: embed the script (hook + beats + CTA), find its k nearest ANALYZED
// winners from the imported sheet (by creative-text cosine similarity), and
// report the spend-weighted median of their real ROAS, with the neighbors as
// evidence.
//
// HONESTY NOTE: our backtest (scripts/backtest-roas-similarity.ts) showed weak
// rank signal within winners-only data (ρ≈0.05) — so this is a DIRECTIONAL
// estimate ("what similar proven winners did"), not a validated forecast. The
// UI labels it accordingly and always shows the evidence, never a bare number.

import { supabase } from "@/lib/db";
import { embedTexts, cosine } from "@/lib/cellumove/embeddings";
import type { SheetWinner, SheetWinnersDoc } from "@/lib/cellumove/sheet-winners";

const K = 10;

export interface RoasNeighbor {
  adName: string;
  market: string;
  roas: number;
  spend: number;
  headline: string;
  postLink: string | null;   // link to the original ad post (null when the sheet had none)
  imagePath: string;         // persisted creative thumbnail ("" when not analyzed)
}

export interface RoasEstimate {
  roas: number;                          // spend-weighted median ROAS of the k nearest winners
  p25: number;                           // neighbor ROAS quartiles — the honest band
  p75: number;
  confidence: "high" | "medium" | "low"; // from mean similarity (low = novel territory)
  meanSim: number;
  neighbors: RoasNeighbor[];             // top 3, as evidence
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

// Spend-weighted ROAS quantile — the point (q=0.5) and the band (q=0.25/0.75)
// come from the SAME weighted distribution, so the point always sits inside the band.
function spendWeightedQuantile(items: { roas: number; spend: number }[], q: number): number {
  const sorted = [...items].sort((a, b) => a.roas - b.roas);
  const total = sorted.reduce((s, x) => s + x.spend, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.spend;
    if (acc >= total * q) return x.roas;
  }
  return sorted[sorted.length - 1]?.roas ?? 0;
}

// The winner bank (analyzed winners + their embeddings), cached per import in
// this server process — re-embedding 1.5k ads costs a few seconds on first use.
let bankCache: { key: string; winners: SheetWinner[]; embs: number[][] } | null = null;

async function loadBank(): Promise<{ winners: SheetWinner[]; embs: number[][] } | null> {
  const res = await supabase
    .from("Research")
    .select("drafts")
    .eq("type", "sheet_winners")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  let doc: SheetWinnersDoc;
  try {
    doc = JSON.parse((res.data as { drafts: string }).drafts) as SheetWinnersDoc;
  } catch {
    return null;
  }
  const winners = doc.winners.filter((w) => w.enrichment);
  if (winners.length < 50) return null; // not enough evidence to be useful
  const key = `${doc.importedAt}:${winners.length}`;
  if (bankCache?.key === key) return bankCache;
  const embs = await embedTexts(winners.map(repText));
  if (!embs) return null;
  bankCache = { key, winners, embs };
  return bankCache;
}

/** Estimate ROAS for each script text. null per entry when the bank/embeddings are unavailable. */
export async function predictScriptsRoas(texts: string[]): Promise<(RoasEstimate | null)[]> {
  if (!texts.length) return [];
  const bank = await loadBank();
  if (!bank) return texts.map(() => null);
  const scriptEmbs = await embedTexts(texts);
  if (!scriptEmbs) return texts.map(() => null);

  return scriptEmbs.map((emb) => {
    const sims = bank.winners.map((w, j) => ({ j, sim: cosine(emb, bank.embs[j] ?? []) }));
    sims.sort((a, b) => b.sim - a.sim);
    const top = sims.slice(0, K);
    if (!top.length) return null;
    const weighted = top.map(({ j }) => ({ roas: bank.winners[j]!.roas, spend: bank.winners[j]!.spend }));
    const meanSim = top.reduce((s, x) => s + x.sim, 0) / top.length;
    return {
      roas: spendWeightedQuantile(weighted, 0.5),
      p25: spendWeightedQuantile(weighted, 0.25),
      p75: spendWeightedQuantile(weighted, 0.75),
      confidence: meanSim >= 0.8 ? "high" : meanSim >= 0.7 ? "medium" : "low",
      meanSim,
      neighbors: top.slice(0, 3).map(({ j }) => {
        const w = bank.winners[j]!;
        return {
          adName: w.adName,
          market: w.market,
          roas: w.roas,
          spend: w.spend,
          headline: w.enrichment!.headline || w.enrichment!.primaryText,
          postLink: w.postLink,
          imagePath: w.enrichment!.imagePath || "",
        };
      }),
    };
  });
}
