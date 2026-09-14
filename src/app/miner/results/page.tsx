import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { CORPUS_ENGINE_VERSION, CORPUS_EXTRACT_PROMPT_VERSION, CORPUS_TAXONOMY_VERSION, CORPUS_TRANSCRIBE_PROMPT_VERSION } from "@/lib/cellumove/corpus/constants";
import { latestGate1 } from "@/lib/cellumove/corpus/eval.server";
import { latestReports } from "@/lib/cellumove/corpus/mine.server";
import { formatReportTables, type ReportTable } from "@/lib/cellumove/corpus/report";
import { loadAdTeardowns } from "@/lib/cellumove/corpus/teardown.server";
import { MinerTabs } from "../MinerTabs";
import { STAGES, loadCorpusState, loadReviewQueue, type CorpusState, type ReviewQueueItem } from "@/lib/cellumove/corpus/state.server";
import { WINNER_SCORE_LABEL, rankLabel } from "@/lib/cellumove/corpus/winner-score";

export const metadata: Metadata = { title: "Results - Corpus Miner · AdFactory" };
export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  ingested: "Collected",
  media: "Video saved",
  transcribed: "Words captured",
  extracted: "Split into parts",
  needs_review: "Needs a look",
  failed: "Could not process",
  skipped: "Not used",
};

function stageTag(stage: string): string {
  if (stage === "extracted") return "tag tag-ok";
  if (stage === "needs_review" || stage === "failed") return "tag tag-danger";
  if (stage === "skipped") return "tag";
  return "tag tag-warn";
}

function teardownTag(status: string): string {
  if (status === "completed") return "tag tag-ok";
  if (status === "failed") return "tag tag-danger";
  return "tag tag-warn";
}

function ReportTableView({ table }: { table: ReportTable }) {
  const highlighted = new Set(table.highlightRows ?? []);
  return (
    <div className="card overflow-x-auto">
      <h3 className="font-semibold">{table.title}</h3>
      {table.note && <p className="mt-1 text-xs text-ink-500">{table.note}</p>}
      {table.rows.length ? (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-400">{table.columns.map((column) => <th key={column} className="py-1 pr-3 font-medium">{column}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className={highlighted.has(index) ? "bg-amber-50 font-medium" : ""}>
                {row.map((cell, cellIndex) => <td key={cellIndex} className="border-t border-ink-100 py-1 pr-3 tabular-nums">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-2 text-sm text-ink-500">Nothing above the support threshold yet.</p>}
    </div>
  );
}

function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  if (!items.length) return <p className="text-sm text-ink-500">No ads waiting for review.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-400"><th className="py-1 pr-3 font-medium">Brand</th><th className="py-1 pr-3 font-medium">Ad</th><th className="py-1 pr-3 font-medium">Attempts</th><th className="py-1 pr-3 font-medium">Why</th></tr></thead>
      <tbody>
        {items.map(({ run, ad }) => (
          <tr key={run.id}>
            <td className="border-t border-ink-100 py-1.5 pr-3">{ad.brandName}</td>
            <td className="border-t border-ink-100 py-1.5 pr-3"><Link href={`/miner/${ad.id}`} className="font-medium hover:underline">{ad.id}</Link></td>
            <td className="border-t border-ink-100 py-1.5 pr-3 tabular-nums">{run.attempts}</td>
            <td className="border-t border-ink-100 py-1.5 pr-3 text-ink-600"><span className="tag tag-danger mr-2">{run.errorCode ?? "?"}</span>{run.errorSummary?.slice(0, 160)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function MinerPage({ searchParams }: { searchParams: Promise<{ cohort?: string }> }) {
  await requireUser();
  const query = await searchParams;

  let state: CorpusState;
  try {
    state = await loadCorpusState();
  } catch (error) {
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-semibold tracking-tight">Corpus Miner</h1><p className="mt-1 text-sm text-ink-500">Competitor ads → two-channel transcripts → coded beats → mined patterns.</p></header>
        <div className="card border-amber-300 bg-amber-50"><h2 className="font-semibold text-amber-900">Database setup required</h2><p className="mt-2 text-sm text-amber-800">Apply <code>migrations/017_corpus_miner.sql</code> through <code>023_corpus_visuals_and_playbook.sql</code>, then reload this page.</p><p className="mt-2 text-xs text-amber-700">{error instanceof Error ? error.message : String(error)}</p></div>
      </div>
    );
  }
  const [queue, reports, gate, teardowns] = await Promise.all([
    loadReviewQueue(),
    latestReports(),
    latestGate1(),
    // Fail-soft: the page predates migration 018.
    loadAdTeardowns().catch((error: unknown) => {
      console.error("[miner] AdTeardown unavailable:", error);
      return [];
    }),
  ]);
  const teardownByAd = new Map(teardowns.map((row) => [row.competitorAdId, row]));
  const teardownsDone = teardowns.filter((row) => row.status === "completed").length;
  const teardownsPending = teardowns.filter((row) => row.status === "queued" || row.status === "processing").length;
  const failed = state.rows.filter((row) => row.stage === "failed");
  const selectedKey = query.cohort ?? "all:all";
  const selected = reports.find((item) => `${item.row.cohort}:${item.row.cohortKey}` === selectedKey) ?? reports[0] ?? null;
  const ranked = state.rows.filter((row) => row.winnerScore != null).sort((a, b) => (b.winnerScore ?? 0) - (a.winnerScore ?? 0));
  const rankById = new Map(ranked.map((row, index) => [row.id, index + 1]));

  return (
    <div className="space-y-8">
      <MinerTabs active="results" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">The numbers behind the playbooks: what every processed ad is made of, which patterns repeat, and anything that needs a second look. Start or continue a run on <Link href="/miner" className="font-medium text-ink-800 underline-offset-2 hover:underline">Run pipeline</Link>.</p>
        <details className="mt-2 text-xs text-ink-400"><summary className="cursor-pointer">Versions</summary><p className="mt-1">engine {CORPUS_ENGINE_VERSION} · beat list {CORPUS_TAXONOMY_VERSION} · transcribe {CORPUS_TRANSCRIBE_PROMPT_VERSION} · split {CORPUS_EXTRACT_PROMPT_VERSION}</p></details>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => (
          <div key={stage} className="card"><div className="text-sm font-medium">{STAGE_LABEL[stage]}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{state.counts[stage]}</div></div>
        ))}
        <div className="card"><div className="text-sm font-medium">Deep-dived</div><div className="mt-2 text-2xl font-semibold tabular-nums">{teardownsDone}</div>{teardownsPending > 0 && <div className="text-xs text-ink-500">{teardownsPending} in progress</div>}</div>
        <div className={`card ${gate?.passed ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
          <div className="text-sm font-medium">Accuracy check</div>
          <div className="mt-2 text-sm">{gate ? `${gate.passed ? "Passed" : "Failed"} · agrees with people on ${Math.round((gate.layerAgreement ?? 0) * 100)}% of stages and ${Math.round((gate.codeAgreement ?? 0) * 100)}% of parts, across ${gate.goldAdCount} hand-labelled ads` : "Not run yet — needs the hand-labelled ads. Until then the labels below are provisional."}</div>
        </div>
      </section>

      {state.expiringSoon > 0 && (
        <div className="card border-red-200 bg-red-50"><p className="text-sm text-red-800"><strong>{state.expiringSoon} video link(s) expire within 24 hours</strong> and have not been saved yet. Open <Link href="/miner" className="font-medium underline">Run pipeline</Link> and save the videos before then, or they must be collected again.</p></div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Needs a look <span className="ml-2 text-sm font-normal text-ink-500">{queue.length}</span></h2>
        <p className="text-xs text-ink-500">The extractor failed the evidence gate twice for these ads. No beats were written; open one to compare the transcript with what the model returned.</p>
        <div className="card"><ReviewQueue items={queue} /></div>
      </section>

      {failed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Failed <span className="ml-2 text-sm font-normal text-ink-500">{failed.length}</span></h2>
          <div className="card">
            <ul className="space-y-1 text-sm">
              {failed.map((row) => (
                <li key={row.id}><Link href={`/miner/${row.id}`} className="font-medium hover:underline">{row.brandName} · {row.id}</Link> <span className="text-ink-500">— {row.mediaStatus && row.mediaStatus !== "downloaded" ? `media ${row.mediaStatus}: ${row.mediaReason ?? ""}` : row.transcriptStatus === "failed" ? "transcription failed" : row.extractError ?? "extraction failed"}</span></li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section id="pattern-report" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-semibold">Patterns</h2><p className="text-xs text-ink-500">What repeats across the ads below.</p></div>
          {reports.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs">
              {reports.map((item) => {
                const key = `${item.row.cohort}:${item.row.cohortKey}`;
                const active = selected && `${selected.row.cohort}:${selected.row.cohortKey}` === key;
                return <Link key={key} href={`/miner/results?cohort=${encodeURIComponent(key)}`} className={active ? "tag tag-ok" : "tag"}>{item.row.cohort === "all" ? "All competitors" : item.row.cohortKey} · {item.row.adCount}</Link>;
              })}
            </div>
          )}
        </div>
        {selected ? (
          <>
            <p className="text-xs text-ink-500">{selected.report.adCount} ads · {selected.report.scoredAdCount} scored · generated {new Date(selected.row.createdAt).toLocaleString("en-GB")} · min support {selected.report.minSupport}</p>
            {selected.report.caveats.length > 0 && (
              <div className="card border-amber-200 bg-amber-50/60"><h3 className="text-sm font-semibold text-amber-900">Caveats</h3><ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{selected.report.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></div>
            )}
            <div className="grid gap-4">{formatReportTables(selected.report).map((table) => <ReportTableView key={table.title} table={table} />)}</div>
          </>
        ) : (
          <div className="card py-10 text-center">
            <p className="text-sm font-medium text-ink-800">No patterns yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">Patterns appear once a brand&apos;s ads have been split into their parts.</p>
            <Link href="/miner" className="btn btn-primary mt-4">Go to Run pipeline</Link>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Every ad <span className="ml-2 text-sm font-normal text-ink-500">{state.rows.length}</span></h2>
        <p className="text-xs text-ink-500">{WINNER_SCORE_LABEL}</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-400"><th className="py-1 pr-3 font-medium">Brand</th><th className="py-1 pr-3 font-medium">Ad</th><th className="py-1 pr-3 font-medium">Stage</th><th className="py-1 pr-3 font-medium">Format</th><th className="py-1 pr-3 font-medium">Duration</th><th className="py-1 pr-3 font-medium">Lines</th><th className="py-1 pr-3 font-medium">Parts</th><th className="py-1 pr-3 font-medium">Teardown</th><th className="py-1 pr-3 font-medium">Rank</th></tr></thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-t border-ink-100 py-1.5 pr-3">{row.brandName}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3"><Link href={`/miner/${row.id}`} className="font-medium hover:underline">{row.id}</Link>{row.hasBrandSearchTranscript && <span className="ml-2 tag">provider transcript</span>}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3"><span className={stageTag(row.stage)}>{STAGE_LABEL[row.stage]}</span></td>
                  <td className="border-t border-ink-100 py-1.5 pr-3">{row.formatTag ?? "—"}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3 tabular-nums">{row.durationSec != null ? `${row.durationSec.toFixed(0)}s` : "—"}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3 tabular-nums">{row.segmentCount ?? "—"}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3 tabular-nums">{row.beatCount || "—"}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3">{teardownByAd.has(row.id) ? <span className={teardownTag(teardownByAd.get(row.id)!.status)}>{teardownByAd.get(row.id)!.status}</span> : "—"}</td>
                  <td className="border-t border-ink-100 py-1.5 pr-3 tabular-nums">{rankById.has(row.id) ? `${rankLabel(rankById.get(row.id)!, ranked.length)} · ${row.winnerScore!.toFixed(0)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
