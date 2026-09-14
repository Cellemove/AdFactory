"use client";

import { useState } from "react";
import { formatUsd, TEARDOWN_USD_PER_AD } from "@/lib/cellumove/corpus/estimate";
import { stageDef } from "../stages";
import type { BrandSummary, PipelineRun, RunSnapshot } from "../types";
import { AdDetailList } from "./AdDetailList";
import { Stat } from "./controls";
import { PlayIcon, SparkIcon, Spinner, StopIcon } from "./icons";

/**
 * Deliberately outside the one-click run: every ad here costs real money, so it
 * gets its own button and its own confirmation.
 */
export function TeardownCard({ snapshot, brand, run, canRun, busy, stopping, onRun, onStop }: {
  snapshot: RunSnapshot;
  brand: BrandSummary;
  run: PipelineRun | null;
  canRun: boolean;
  busy: boolean;
  stopping: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const def = stageDef("teardown");
  const stats = snapshot.stages.teardown;
  const active = run?.phase === "running" && run.current === "teardown";
  const estimate = stats.ready * TEARDOWN_USD_PER_AD;

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <SparkIcon className="h-4 w-4 text-brand-pink" />{def.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">{def.blurb}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {canRun && (active ? (
            <button type="button" className="btn" disabled={stopping} onClick={onStop}>
              {stopping ? <><Spinner className="h-3.5 w-3.5" />Stopping…</> : <><StopIcon className="h-3.5 w-3.5" />Stop watching</>}
            </button>
          ) : confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500">{stats.ready} ads · about {formatUsd(estimate)}</span>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn btn-primary text-xs" onClick={() => { setConfirming(false); onRun(); }}>Confirm</button>
            </div>
          ) : (
            <button type="button" className="btn" disabled={busy || stats.ready === 0} onClick={() => setConfirming(true)}>
              <PlayIcon className="h-3.5 w-3.5" />{stats.ready === 0 ? "Up to date" : `Deep-dive ${stats.ready} ads`}
            </button>
          ))}
          <div className="flex flex-wrap justify-end gap-1.5">
            <Stat label="done" value={stats.done} tone="ok" />
            {stats.ready > 0 && <Stat label="ready" value={stats.ready} tone="ink" />}
            {stats.failed > 0 && <Stat label="failed" value={stats.failed} tone="danger" />}
          </div>
        </div>
      </div>

      {active && run.rows.length > 0 && (
        <details className="rounded-xl border border-ink-100 bg-ink-50/60 p-3" open>
          <summary className="cursor-pointer text-sm font-medium text-ink-800">
            Teardown is working on {run.rows.filter((row) => row.status === "queued" || row.status === "processing").length} ads · checked every 15s
          </summary>
          <div className="mt-3"><AdDetailList rows={run.rows} /></div>
        </details>
      )}
    </section>
  );
}
