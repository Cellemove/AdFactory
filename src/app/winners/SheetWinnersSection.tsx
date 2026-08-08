"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importSheetWinners, enrichSheetWinner } from "../actions/sheet-winners";
import {
  sheetWinnerKey,
  type SheetWinner,
  type SheetWinnersDoc,
  type SheetWinnerEnrichment,
} from "@/lib/cellumove/sheet-winners";

const PAGE_SIZE = 25;
const BATCH_SIZE = 25;

type SortDir = "asc" | "desc";
type SortCol = "adName" | "market" | "angle" | "hook" | "funnel" | "roas" | "spend";
interface Sort { col: SortCol; dir: SortDir }

// Column accessor for sorting — enrichment-derived columns sort blanks last.
function sortValue(w: SheetWinner, col: SortCol): string | number {
  switch (col) {
    case "roas": return w.roas;
    case "spend": return w.spend;
    case "adName": return w.adName.toLowerCase();
    case "market": return w.market;
    case "angle": return (w.angle || "￿").toLowerCase();
    case "hook": return w.enrichment?.hookType || "￿";
    case "funnel": return w.enrichment?.funnel || "￿";
  }
}

export function SheetWinnersSection({ doc }: { doc: SheetWinnersDoc | null }) {
  const router = useRouter();
  const [importing, startImport] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Filters
  const [market, setMarket] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [hook, setHook] = useState<string>("all");
  const [funnel, setFunnel] = useState<string>("all");
  const [adType, setAdType] = useState<string>("all");
  const [angle, setAngle] = useState<string>("all");
  // Default to analyzed-only: un-analyzed rows are dark/removed posts with no
  // creative data — pure noise. The dropdown can still surface them for retries.
  const [status, setStatus] = useState<"all" | "analyzed" | "pending">("analyzed");
  const [sort, setSort] = useState<Sort>({ col: "spend", dir: "desc" });
  const [page, setPage] = useState(0);
  const resetPage = () => setPage(0);

  // Enrichments landed THIS session overlay the server doc, so each analyzed ad
  // appears instantly without a full refresh.
  const [enrichedMap, setEnrichedMap] = useState<Record<string, SheetWinnerEnrichment>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null); // winner key, or "batch"
  const [batch, setBatch] = useState<{ done: number; total: number; failed: number } | null>(null);

  const winners = useMemo<SheetWinner[]>(
    () =>
      (doc?.winners ?? []).map((w) => {
        const e = enrichedMap[sheetWinnerKey(w)];
        return e ? { ...w, enrichment: e } : w;
      }),
    [doc, enrichedMap],
  );
  const enrichedCount = winners.filter((w) => w.enrichment).length;

  // Distinct filter options (with counts), derived from the live data.
  const options = useMemo(() => {
    const count = (get: (w: SheetWinner) => string | undefined | null) => {
      const m = new Map<string, number>();
      for (const w of winners) {
        const v = (get(w) ?? "").trim();
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      hooks: count((w) => w.enrichment?.hookType),
      funnels: count((w) => w.enrichment?.funnel),
      angles: count((w) => w.angle),
    };
  }, [winners]);

  const refresh = () => {
    setError(null);
    setFlash(null);
    startImport(async () => {
      try {
        const r = await importSheetWinners();
        setFlash(`Imported ${r.total.toLocaleString()} winning ads.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const analyzeOne = async (key: string) => {
    setError(null);
    setAnalyzing(key);
    try {
      const e = await enrichSheetWinner(key);
      setEnrichedMap((m) => ({ ...m, [key]: e }));
      setOpenKey(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(null);
    }
  };

  // Analyze the next BATCH_SIZE un-analyzed ads by spend (sequential, fail-soft).
  const analyzeBatch = async () => {
    const pending = winners.filter((w) => !w.enrichment && w.postLink).slice(0, BATCH_SIZE);
    if (!pending.length) return;
    setError(null);
    setAnalyzing("batch");
    setBatch({ done: 0, total: pending.length, failed: 0 });
    let failed = 0;
    let done = 0;
    for (const p of pending) {
      const key = sheetWinnerKey(p);
      try {
        const e = await enrichSheetWinner(key);
        setEnrichedMap((m) => ({ ...m, [key]: e }));
      } catch {
        failed++;
      }
      done++;
      setBatch({ done, total: pending.length, failed });
    }
    setAnalyzing(null);
    setBatch(null);
    setFlash(`Analyzed ${pending.length - failed} ads${failed ? ` · ${failed} failed (dark/removed posts)` : ""}.`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = winners.filter((w) => {
      if (market !== "all" && w.market !== market) return false;
      if (status === "analyzed" && !w.enrichment) return false;
      if (status === "pending" && w.enrichment) return false;
      if (hook !== "all" && (w.enrichment?.hookType ?? "") !== hook) return false;
      if (funnel !== "all" && (w.enrichment?.funnel ?? "") !== funnel) return false;
      if (adType !== "all" && (w.enrichment?.adType ?? "") !== adType) return false;
      if (angle !== "all" && w.angle !== angle) return false;
      if (q && !(`${w.adName} ${w.angle} ${w.enrichment?.headline ?? ""} ${w.enrichment?.primaryText ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.col);
      const vb = sortValue(b, sort.col);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [winners, market, query, hook, funnel, adType, angle, status, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const busy = analyzing !== null || importing;
  const filtersActive =
    market !== "all" || hook !== "all" || funnel !== "all" || adType !== "all" || angle !== "all" || status !== "analyzed" || query.trim() !== "";

  const clearFilters = () => {
    setMarket("all"); setHook("all"); setFunnel("all"); setAdType("all"); setAngle("all"); setStatus("analyzed"); setQuery("");
    resetPage();
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Imported winning ads</h2>
          <p className="text-sm text-ink-500">
            From the team&apos;s Google Sheet · winners = ROAS ≥ {doc?.criteria.minRoas ?? 1.8} and spend ≥{" "}
            {doc?.criteria.minSpend ?? 30} ({doc?.criteria.roasMetric ?? "7-day"} ROAS). Click column headers to sort.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            {doc && (
              <button
                className="btn"
                onClick={analyzeBatch}
                disabled={busy || winners.every((w) => w.enrichment || !w.postLink)}
                title="Fetch each ad's creative + text from its FB post and extract headline/visual/hook with Gemini"
              >
                {analyzing === "batch" && batch
                  ? `Analyzing ${batch.done}/${batch.total}…`
                  : `✨ Analyze top ${BATCH_SIZE}`}
              </button>
            )}
            <button className="btn btn-primary" onClick={refresh} disabled={busy}>
              {importing ? "Importing…" : doc ? "↻ Refresh from sheet" : "↓ Import from sheet"}
            </button>
          </div>
          {doc && (
            <span className="text-[11px] text-ink-400">
              last imported {new Date(doc.importedAt).toLocaleString()}
              {enrichedCount > 0 && ` · ${enrichedCount.toLocaleString()} analyzed`}
            </span>
          )}
        </div>
      </header>

      {flash && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</div>}
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!doc ? (
        <div className="card">
          <p className="text-sm text-ink-500">
            Nothing imported yet. Click <span className="font-medium">Import from sheet</span> to pull the winning ads
            (ROAS ≥ 1.8 and spend ≥ 30) from the Google Sheet.
          </p>
        </div>
      ) : (
        <div className="card space-y-3">
          {/* Summary + per-market chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag tag-ok">{doc.total.toLocaleString()} winners</span>
            {doc.byMarket.map((m) => (
              <button
                key={m.market}
                onClick={() => { setMarket((cur) => (cur === m.market ? "all" : m.market)); resetPage(); }}
                className={`tag transition ${market === m.market ? "tag-warn" : "hover:border-ink-900"}`}
                title={`Filter to ${m.market}`}
              >
                {m.market} · {m.count}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input h-8 flex-1 min-w-[170px] py-0 text-sm"
              placeholder="Search name, angle, headline, primary text…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetPage(); }}
            />
            <select className="input h-8 w-auto py-0 text-xs" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); resetPage(); }}>
              <option value="all">All ({winners.length.toLocaleString()})</option>
              <option value="analyzed">Analyzed ({enrichedCount.toLocaleString()})</option>
              <option value="pending">Not analyzed ({(winners.length - enrichedCount).toLocaleString()})</option>
            </select>
            <select className="input h-8 w-auto py-0 text-xs" value={hook} onChange={(e) => { setHook(e.target.value); resetPage(); }}>
              <option value="all">Hook: all</option>
              {options.hooks.map(([v, n]) => (
                <option key={v} value={v}>{v} ({n})</option>
              ))}
            </select>
            <select className="input h-8 w-auto py-0 text-xs" value={funnel} onChange={(e) => { setFunnel(e.target.value); resetPage(); }}>
              <option value="all">Funnel: all</option>
              {options.funnels.map(([v, n]) => (
                <option key={v} value={v}>{v} ({n})</option>
              ))}
            </select>
            <select className="input h-8 w-auto py-0 text-xs" value={adType} onChange={(e) => { setAdType(e.target.value); resetPage(); }}>
              <option value="all">Type: all</option>
              <option value="static">static</option>
              <option value="video">video</option>
            </select>
            <select className="input h-8 w-auto max-w-[180px] py-0 text-xs" value={angle} onChange={(e) => { setAngle(e.target.value); resetPage(); }}>
              <option value="all">Angle: all</option>
              {options.angles.map(([v, n]) => (
                <option key={v} value={v}>{v} ({n})</option>
              ))}
            </select>
            {filtersActive && (
              <button className="text-xs text-ink-500 underline hover:text-ink-900" onClick={clearFilters}>
                clear filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-500">
                  <th className="w-12 py-1.5 pr-3"></th>
                  <Th label="Ad name" col="adName" sort={sort} setSort={setSort} onSort={resetPage} />
                  <Th label="Market" col="market" sort={sort} setSort={setSort} onSort={resetPage} />
                  <Th label="Angle" col="angle" sort={sort} setSort={setSort} onSort={resetPage} />
                  <Th label="Hook" col="hook" sort={sort} setSort={setSort} onSort={resetPage} />
                  <Th label="Funnel" col="funnel" sort={sort} setSort={setSort} onSort={resetPage} />
                  <Th label="ROAS" col="roas" sort={sort} setSort={setSort} onSort={resetPage} right />
                  <Th label="Spend" col="spend" sort={sort} setSort={setSort} onSort={resetPage} right />
                  <th className="py-1.5 pl-3 font-semibold">Link</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((w) => {
                  const key = sheetWinnerKey(w);
                  const e = w.enrichment;
                  const open = openKey === key;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={`border-b border-ink-100 align-top last:border-0 ${e ? "cursor-pointer hover:bg-ink-50/60" : ""} ${open ? "bg-ink-50/60" : ""}`}
                        onClick={e ? () => setOpenKey(open ? null : key) : undefined}
                      >
                        <td className="py-1.5 pr-3">
                          {e?.imagePath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.imagePath} alt={w.adName} className="h-11 w-11 rounded border border-ink-200 object-cover" />
                          ) : (
                            <div className="h-11 w-11 rounded border border-dashed border-ink-200 bg-ink-50" aria-hidden />
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-800">
                          {w.adName}
                          {e?.headline?.trim() && (
                            <div className="mt-0.5 line-clamp-1 text-xs text-ink-500">&ldquo;{e.headline}&rdquo;</div>
                          )}
                        </td>
                        <td className="py-1.5 pr-3"><span className="tag">{w.market}</span></td>
                        <td className="py-1.5 pr-3 text-ink-600">{w.angle || <span className="text-ink-300">—</span>}</td>
                        <td className="py-1.5 pr-3 text-xs text-ink-600">{e?.hookType || <span className="text-ink-300">—</span>}</td>
                        <td className="py-1.5 pr-3 text-xs text-ink-600">{e?.funnel || <span className="text-ink-300">—</span>}</td>
                        <td className="py-1.5 pr-3 text-right font-medium text-ink-900">{w.roas.toFixed(2)}×</td>
                        <td className="py-1.5 pr-3 text-right text-ink-700">
                          {w.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-1.5 pl-3" onClick={(ev) => ev.stopPropagation()}>
                          {w.postLink ? (
                            <a href={w.postLink} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-accent underline hover:text-ink-900">
                              open ↗
                            </a>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="py-1.5" onClick={(ev) => ev.stopPropagation()}>
                          {e ? (
                            <button className="btn btn-ghost text-xs" onClick={() => setOpenKey(open ? null : key)}>
                              {open ? "▴" : "▾"}
                            </button>
                          ) : w.postLink ? (
                            <button
                              className="btn btn-ghost text-xs"
                              onClick={() => analyzeOne(key)}
                              disabled={busy}
                              title="Fetch the creative + text and extract headline/visual/hook"
                            >
                              {analyzing === key ? "…" : "✨ analyze"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {e && open && (
                        <tr className="border-b border-ink-100 bg-ink-50/40 last:border-0">
                          <td colSpan={10} className="p-3">
                            <EnrichmentDetail w={w} e={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-ink-400">No winners match these filters.</p>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-ink-500">
              <button className="btn btn-ghost text-xs" onClick={() => setPage(current - 1)} disabled={current === 0}>
                ← Prev
              </button>
              <span>
                Page {current + 1} of {pageCount} · {filtered.length.toLocaleString()} shown
              </span>
              <button className="btn btn-ghost text-xs" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1}>
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Sortable column header — click toggles desc → asc.
function Th({
  label,
  col,
  sort,
  setSort,
  onSort,
  right,
}: {
  label: string;
  col: SortCol;
  sort: Sort;
  setSort: (fn: (s: Sort) => Sort) => void;
  onSort: () => void;
  right?: boolean;
}) {
  const active = sort.col === col;
  return (
    <th
      className={`cursor-pointer select-none py-1.5 pr-3 font-semibold hover:text-ink-900 ${right ? "text-right" : ""} ${active ? "text-ink-900" : ""}`}
      onClick={() => {
        setSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));
        onSort();
      }}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
}

// The analyzed creative, presented like a curated Winners-library card.
function EnrichmentDetail({ w, e }: { w: SheetWinner; e: SheetWinnerEnrichment }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {e.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.imagePath} alt={w.adName} className="max-h-48 w-auto rounded border border-ink-200" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`tag ${e.adType === "video" ? "tag-warn" : "tag-ok"}`}>{e.adType}</span>
          {e.funnel && <span className="tag">{e.funnel}</span>}
          {e.hookType && <span className="tag">{e.hookType}</span>}
          <span className="text-[11px] text-ink-400">analyzed {new Date(e.enrichedAt).toLocaleDateString()}</span>
        </div>
        {e.headline?.trim() && (
          <p className="text-sm">
            <span className="text-xs uppercase tracking-wide text-ink-500">Headline · </span>
            {e.headline}
          </p>
        )}
        {e.visualConcept?.trim() && (
          <p className="text-sm text-ink-700">
            <span className="text-xs uppercase tracking-wide text-ink-500">Visual · </span>
            {e.visualConcept}
          </p>
        )}
        {e.primaryText?.trim() && (
          <p className="text-sm text-ink-700">
            <span className="text-xs uppercase tracking-wide text-ink-500">Primary text · </span>
            {e.primaryText}
          </p>
        )}
      </div>
    </div>
  );
}
