"use client";

import Link from "next/link";
import { estimateRun, formatMinutes, formatUsd, formatUsdRange } from "@/lib/cellumove/corpus/estimate";
import { etaSeconds, formatClock, formatDuration, overallPercent, totalCostUsd, totals } from "../progress";
import { stageDef } from "../stages";
import type { BrandSummary, PipelineRun, RunSnapshot } from "../types";
import { AdDetailList } from "./AdDetailList";
import { ProgressBar, SegmentedProgress } from "./controls";
import { AlertIcon, ArrowIcon, CheckIcon, ClockIcon, CrossIcon, PlayIcon, Spinner, StopIcon } from "./icons";

function Countdown({ iso, now }: { iso: string; now: number }) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return <>expired</>;
  const hours = Math.floor(ms / 3_600_000);
  return <>{hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`}</>;
}

export function RunHero({ brand, snapshot, run, canRun, busy, stopping, tabHidden, now, onRun, onStop, onDismiss }: {
  brand: BrandSummary;
  snapshot: RunSnapshot;
  run: PipelineRun | null;
  canRun: boolean;
  busy: boolean;
  stopping: boolean;
  tabHidden: boolean;
  now: number;
  onRun: () => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const active = run && run.phase === "running";
  const estimate = estimateRun({ ads: brand.inCorpus || snapshot.defaultTarget, includeCollect: brand.inCorpus === 0, speechOnly: snapshot.researchMode === "speech_only" });
  const undownloaded = snapshot.researchMode === "speech_only" ? 0 : brand.inCorpus - brand.downloaded;

  return (
    <section className="card overflow-hidden p-0">
      <div className="border-b border-ink-100 bg-gradient-to-br from-brand-blush/60 via-white to-white px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{brand.name}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {brand.inCorpus > 0
                ? <>{brand.inCorpus} winning ads · {brand.downloaded} videos saved · {brand.transcribed} read · {brand.extracted} split into parts</>
                : <>Nothing collected yet. One run finds their winning ads, watches them and writes the playbook.</>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {canRun ? (
              active ? (
                <button type="button" className="btn" disabled={stopping} onClick={onStop}>
                  {stopping ? <><Spinner className="h-3.5 w-3.5" />Stopping…</> : <><StopIcon className="h-3.5 w-3.5" />Stop</>}
                </button>
              ) : (
                <button type="button" className="btn btn-primary px-5 py-2 text-[15px]" onClick={onRun}>
                  <PlayIcon className="h-4 w-4" />Run everything
                </button>
              )
            ) : <span className="tag">View only</span>}
            {!active && canRun && (
              <span className="text-xs text-ink-500">
                about {formatMinutes(estimate.minutesLow, estimate.minutesHigh)} · {formatUsdRange(estimate.usdLow, estimate.usdHigh)}
                {brand.inCorpus === 0 && <> · {estimate.credits} credits</>}
              </span>
            )}
          </div>
        </div>

        {brand.inCorpus > 0 && !active && (
          <div className="mt-4">
            <ProgressBar value={brand.percent} max={1} className="h-2" />
            <p className="mt-1.5 text-xs text-ink-500">{Math.round(brand.percent * 100)}% done</p>
          </div>
        )}

        {undownloaded > 0 && brand.linksExpireAt && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
            <ClockIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span><strong className="font-semibold">{undownloaded} video link{undownloaded === 1 ? "" : "s"} expire in <Countdown iso={brand.linksExpireAt} now={now} /></strong> — download them before then, or they have to be collected again.</span>
          </p>
        )}
      </div>

      {run && <RunProgress run={run} now={now} tabHidden={tabHidden} onDismiss={onDismiss} brand={brand} snapshot={snapshot} />}
    </section>
  );
}

function RunProgress({ run, now, tabHidden, onDismiss, brand, snapshot }: { run: PipelineRun; now: number; tabHidden: boolean; onDismiss: () => void; brand: BrandSummary; snapshot: RunSnapshot }) {
  const percent = Math.round(overallPercent(run) * 100);
  const cost = totalCostUsd(run);
  const sums = totals(run);
  const current = run.current ? run.stages[run.current] : undefined;
  const eta = tabHidden ? null : etaSeconds(current, now);
  const live = run.phase === "running";
  const elapsed = formatClock((run.finishedAt ?? now) - run.startedAt);

  let headline: string;
  if (run.phase === "error") headline = "The run stopped";
  else if (run.phase === "stopped") headline = "Stopped";
  else if (run.phase === "partial") headline = "Finished with items needing attention";
  else if (run.phase === "finished") headline = `Finished ${brand.name}`;
  else if (current && current.total > 0) headline = `${stageDef(current.key).title} · ${Math.min(current.settled + 1, current.total)} of ${current.total}`;
  else if (run.current) headline = stageDef(run.current).title;
  else headline = "Working…";

  return (
    <div className="space-y-3 px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
          {live ? <Spinner className="h-4 w-4 text-ink-700" />
            : run.phase === "error" ? <CrossIcon className="h-4 w-4 text-red-600" />
              : run.phase === "stopped" || run.phase === "partial" ? <AlertIcon className="h-4 w-4 text-amber-600" />
                : <CheckIcon className="h-4 w-4 text-emerald-600" />}
          {headline}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-500">
          {eta != null && <span>about {formatDuration(eta)} left</span>}
          {cost > 0 && <span>{formatUsd(cost)}</span>}
          <span>{elapsed}</span>
        </div>
      </div>

      <SegmentedProgress run={run} live={live} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span className="tabular-nums">{percent}%</span>
        <span className="flex flex-wrap gap-x-3">
          {sums.settled > 0 && <span>{sums.settled} attempts processed</span>}
          {sums.review > 0 && <span className="text-amber-700">{sums.review} to review</span>}
          {sums.failed > 0 && <span className="text-red-700">{sums.failed} failed</span>}
        </span>
      </div>

      {run.error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{run.error}</p>}

      {(run.phase === "finished" || run.phase === "partial") && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-50 px-3.5 py-3 text-sm">
          <span className="text-ink-700">
            {brand.name}: {brand.inCorpus} ads · {brand.transcribed} transcribed · {brand.extracted} in beats
            {brand.needsReview > 0 && ` · ${brand.needsReview} need review`} — {elapsed}{cost > 0 ? `, ${formatUsd(cost)}` : ""}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            {snapshot.lastPlaybook && (
              <Link href={`/miner/playbook?brand=${encodeURIComponent(brand.domain)}`} className="btn btn-primary text-xs">
                Open the playbook <ArrowIcon className="h-3.5 w-3.5" />
              </Link>
            )}
            <Link href={`/miner/results?cohort=${encodeURIComponent(`brand:${brand.domain}`)}`} className="btn btn-ghost text-xs">
              See the patterns <ArrowIcon className="h-3.5 w-3.5" />
            </Link>
            <button type="button" className="btn btn-ghost text-xs" onClick={onDismiss}>Dismiss</button>
          </span>
        </div>
      )}

      {run.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-500">
          {run.notes.slice(-4).map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
        </ul>
      )}

      {run.rows.length > 0 && (
        <details className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-800">Details · {run.rows.length} ads in this step</summary>
          <div className="mt-3"><AdDetailList rows={run.rows} /></div>
        </details>
      )}
    </div>
  );
}
