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
    title: "Code frequency",
    note: "How often each code appears, where in the ad it sits (0 = first beat, 1 = last), and how long it runs.",
    columns: ["Code", "Layer", "Ads", "Share", "Occurrences", "Median position", "Median start", "Median seconds"],
    rows: report.codeFrequency.map((row) => [row.code, row.layer, String(row.ads), pct(row.adShare), String(row.occurrences), num(row.medianRelPosition, 2), pct(row.medianRelStart), num(row.medianDurationSec)]),
  });
  tables.push({
    title: "Layer frequency",
    columns: ["Layer", "Ads", "Share", "Median position"],
    rows: report.layerFrequency.map((row) => [row.layer, String(row.ads), pct(row.adShare), num(row.medianRelPosition, 2)]),
  });
  tables.push({
    title: "Positional laws — layers",
    note: `Share of co-occurring ads where X comes before Y. ≥${Math.round(report.lawShare * 100)}% with ≥${report.minSupport} ads is a law.`,
    columns: ["X before Y", "Ads", "Share", "Law"],
    rows: report.positionalLaws.layers.map((row) => [`${row.x} → ${row.y}`, String(row.support), pct(row.share), row.law ? "LAW" : ""]),
    highlightRows: report.positionalLaws.layers.map((row, index) => (row.law ? index : -1)).filter((index) => index >= 0),
  });
  tables.push({
    title: "Positional laws — codes",
    columns: ["X before Y", "Ads", "Share", "Law"],
    rows: report.positionalLaws.codes.map((row) => [`${row.x} → ${row.y}`, String(row.support), pct(row.share), row.law ? "LAW" : ""]),
    highlightRows: report.positionalLaws.codes.map((row, index) => (row.law ? index : -1)).filter((index) => index >= 0),
  });
  tables.push({
    title: "Dominant spines — layers",
    note: "Frequent ordered sub-sequences (PrefixSpan). Closed = no longer pattern has the same support.",
    columns: ["Pattern", "Ads", "Share", "Closed"],
    rows: report.sequences.layerSpines.map((row) => [row.pattern.join(" → "), String(row.support), pct(row.share), row.closed ? "yes" : ""]),
  });
  tables.push({
    title: "Dominant spines — codes",
    columns: ["Pattern", "Ads", "Share", "Closed"],
    rows: report.sequences.codeSpines.map((row) => [row.pattern.join(" → "), String(row.support), pct(row.share), row.closed ? "yes" : ""]),
  });
  const liftNote = report.lift.status === "scored"
    ? `Top quartile (winnerScore ≥ ${num(report.lift.q3)}, n=${report.lift.nTop}) vs bottom quartile (≤ ${num(report.lift.q1)}, n=${report.lift.nBottom}). Lift > 1 = winners do this more. The score is a longevity ranking, not performance truth.`
    : `Needs at least ${report.lift.minimum} scored ads; ${report.scoredAdCount} available.`;
  tables.push({
    title: "Lift — codes",
    note: liftNote,
    columns: ["Code", "Top quartile", "Bottom quartile", "Lift"],
    rows: report.lift.codes.map((row) => [row.key, pct(row.pTop), pct(row.pBottom), num(row.lift, 2)]),
  });
  tables.push({
    title: "Lift — layer spines",
    columns: ["Spine", "Top quartile", "Bottom quartile", "Lift"],
    rows: report.lift.spines.map((row) => [row.key, pct(row.pTop), pct(row.pBottom), num(row.lift, 2)]),
  });
  tables.push({
    title: "Layer duration",
    note: `Median seconds and share of runtime per layer (${report.layerDurations.adsWithDuration} ads with a known duration). The mechanism layer (M) is the known weak zone in this category.`,
    columns: ["Layer", "All · sec", "All · share", "Top · sec", "Top · share", "Bottom · sec", "Bottom · share", "Δ share (top−bottom)"],
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
