// The MINE report contract and its table rendering. Kept separate from the
// mining math so the page and the CLI can format without importing it.

import { createHash } from "node:crypto";

export type CodeFrequencyRow = {
  code: string;
  layer: string;
  ads: number;
  adShare: number;
  occurrences: number;
  medianRelPosition: number | null;
  medianRelStart: number | null;
  medianDurationSec: number | null;
};

export type LayerFrequencyRow = {
  layer: string;
  ads: number;
  adShare: number;
  medianRelPosition: number | null;
};

export type PositionalLawRow = {
  x: string;
  y: string;
  support: number;
  share: number;
  law: boolean;
};

export type SpineRow = {
  pattern: string[];
  support: number;
  share: number;
  closed: boolean;
};

export type LiftRow = {
  key: string;
  pTop: number;
  pBottom: number;
  lift: number;
};

export type LayerDurationCell = { n: number; medianSec: number | null; medianShare: number | null };

export type LayerDurationRow = {
  layer: string;
  highlight: boolean;
  all: LayerDurationCell;
  top: LayerDurationCell;
  bottom: LayerDurationCell;
  deltaShare: number | null;
};

export type CorpusPatternReportJson = {
  engineVersion: string;
  taxonomyVersion: string;
  cohort: string;
  cohortKey: string;
  adCount: number;
  scoredAdCount: number;
  generatedAt: string;
  minSupport: number;
  lawShare: number;
  codeFrequency: CodeFrequencyRow[];
  layerFrequency: LayerFrequencyRow[];
  positionalLaws: { codes: PositionalLawRow[]; layers: PositionalLawRow[] };
  sequences: { codeSpines: SpineRow[]; layerSpines: SpineRow[] };
  lift: {
    status: "scored" | "insufficient";
    minimum: number;
    q1: number | null;
    q3: number | null;
    nTop: number;
    nBottom: number;
    codes: LiftRow[];
    spines: LiftRow[];
  };
  layerDurations: { mechanismLayer: "M"; adsWithDuration: number; rows: LayerDurationRow[] };
  caveats: string[];
};

export type ReportTable = { title: string; note?: string; columns: string[]; rows: string[][]; highlightRows?: number[] };

const pct = (value: number | null | undefined): string => (value == null ? "—" : `${Math.round(value * 100)}%`);
const num = (value: number | null | undefined, digits = 1): string => (value == null ? "—" : value.toFixed(digits));

/** Sorted (adId, extractRunId, winnerScore) tuples → hash; identical corpus ⇒ identical hash. */
export function reportInputHash(ads: Array<{ id: string; extractRunId: string; winnerScore: number | null }>): string {
  const tuples = ads.map((ad) => `${ad.id}:${ad.extractRunId}:${ad.winnerScore ?? ""}`).sort();
  return createHash("sha256").update(tuples.join("|")).digest("hex");
}

export function formatReportTables(report: CorpusPatternReportJson): ReportTable[] {
  const tables: ReportTable[] = [];
  tables.push({
    title: "Which parts they use",
    note: "How often each part appears, where in the ad it usually sits (0 = the very start, 1 = the very end) and how long it runs.",
    columns: ["Part", "Stage", "Ads", "Share of ads", "Times used", "Usual position", "Usual start", "Usual length"],
    rows: report.codeFrequency.map((row) => [row.code, row.layer, String(row.ads), pct(row.adShare), String(row.occurrences), num(row.medianRelPosition, 2), pct(row.medianRelStart), num(row.medianDurationSec)]),
  });
  tables.push({
    title: "Which stages they use",
    note: "The seven stages of an ad: hook, qualify, pain, belief, mechanism, proof, offer.",
    columns: ["Stage", "Ads", "Share of ads", "Usual position"],
    rows: report.layerFrequency.map((row) => [row.layer, String(row.ads), pct(row.adShare), num(row.medianRelPosition, 2)]),
  });
  tables.push({
    title: "Order rules, by stage",
    note: `When both appear in an ad, how often the first comes before the second. ${Math.round(report.lawShare * 100)}% or more, across at least ${report.minSupport} ads, counts as a rule.`,
    columns: ["Comes before", "Ads", "Share", "Rule"],
    rows: report.positionalLaws.layers.map((row) => [`${row.x} → ${row.y}`, String(row.support), pct(row.share), row.law ? "LAW" : ""]),
    highlightRows: report.positionalLaws.layers.map((row, index) => (row.law ? index : -1)).filter((index) => index >= 0),
  });
  tables.push({
    title: "Order rules, by part",
    columns: ["Comes before", "Ads", "Share", "Rule"],
    rows: report.positionalLaws.codes.map((row) => [`${row.x} → ${row.y}`, String(row.support), pct(row.share), row.law ? "LAW" : ""]),
    highlightRows: report.positionalLaws.codes.map((row, index) => (row.law ? index : -1)).filter((index) => index >= 0),
  });
  tables.push({
    title: "Common structures, by stage",
    note: "Sequences that repeat across ads. \"Longest\" marks a sequence no longer version of which is equally common.",
    columns: ["Structure", "Ads", "Share of ads", "Longest"],
    rows: report.sequences.layerSpines.map((row) => [row.pattern.join(" → "), String(row.support), pct(row.share), row.closed ? "yes" : ""]),
  });
  tables.push({
    title: "Common structures, by part",
    columns: ["Structure", "Ads", "Share of ads", "Longest"],
    rows: report.sequences.codeSpines.map((row) => [row.pattern.join(" → "), String(row.support), pct(row.share), row.closed ? "yes" : ""]),
  });
  const liftNote = report.lift.status === "scored"
    ? `The ${report.lift.nTop} strongest-ranked ads compared with the ${report.lift.nBottom} weakest. Above 1 means the strongest ads do it more. The ranking comes from how long ads ran, not from real sales.`
    : `Needs at least ${report.lift.minimum} ranked ads; ${report.scoredAdCount} available so far.`;
  tables.push({
    title: "What the strongest ads do more",
    note: liftNote,
    columns: ["Part", "Strongest ads", "Weakest ads", "How much more"],
    rows: report.lift.codes.map((row) => [row.key, pct(row.pTop), pct(row.pBottom), num(row.lift, 2)]),
  });
  tables.push({
    title: "Structures the strongest ads use more",
    columns: ["Structure", "Strongest ads", "Weakest ads", "How much more"],
    rows: report.lift.spines.map((row) => [row.key, pct(row.pTop), pct(row.pBottom), num(row.lift, 2)]),
  });
  tables.push({
    title: "Time spent on each stage",
    note: `Seconds per stage and the share of the ad it takes up, from ${report.layerDurations.adsWithDuration} ads whose length is known. The mechanism stage — explaining how it works — is the known weak spot in this category.`,
    columns: ["Stage", "All ads", "Share", "Strongest", "Share", "Weakest", "Share", "Difference"],
    rows: report.layerDurations.rows.map((row) => [row.layer, num(row.all.medianSec), pct(row.all.medianShare), num(row.top.medianSec), pct(row.top.medianShare), num(row.bottom.medianSec), pct(row.bottom.medianShare), row.deltaShare == null ? "—" : `${row.deltaShare >= 0 ? "+" : ""}${Math.round(row.deltaShare * 100)}pp`]),
    highlightRows: report.layerDurations.rows.map((row, index) => (row.highlight ? index : -1)).filter((index) => index >= 0),
  });
  return tables;
}

/** Plain-text rendering for the CLI. */
export function renderReportText(report: CorpusPatternReportJson): string {
  const lines: string[] = [];
  lines.push(`Pattern report · ${report.cohort}:${report.cohortKey} · ${report.adCount} ads (${report.scoredAdCount} scored) · taxonomy ${report.taxonomyVersion} · engine ${report.engineVersion}`);
  for (const table of formatReportTables(report)) {
    lines.push("", `## ${table.title}`);
    if (table.note) lines.push(table.note);
    if (!table.rows.length) {
      lines.push("(nothing above the support threshold)");
      continue;
    }
    const widths = table.columns.map((column, index) => Math.max(column.length, ...table.rows.map((row) => (row[index] ?? "").length)));
    const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
    lines.push(line(table.columns), line(widths.map((width) => "-".repeat(width))));
    for (const row of table.rows) lines.push(line(row));
  }
  if (report.caveats.length) {
    lines.push("", "## Caveats");
    for (const caveat of report.caveats) lines.push(`- ${caveat}`);
  }
  return lines.join("\n");
}
