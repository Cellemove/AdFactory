"use client";

import { PIPELINE_STAGES } from "../stages";
import type { BrandSummary, PipelineRun, RunSnapshot, StageKey, StageOptions } from "../types";
import { Segmented, StageBadge, Stat, Toggle } from "./controls";
import { PlayIcon } from "./icons";

function stageState(key: StageKey, snapshot: RunSnapshot, brand: BrandSummary, run: PipelineRun | null): "idle" | "active" | "complete" | "attention" {
  if (run?.phase === "running" && run.current === key) return "active";
  const stats = snapshot.stages[key];
  if (key === "extract" && brand.needsReview > 0) return "attention";
  if (key === "ingest") return brand.inCorpus > 0 ? "complete" : "idle";
  if (stats.total > 0 && stats.ready === 0 && stats.done > 0) return "complete";
  return "idle";
}

function summaryFor(key: StageKey, snapshot: RunSnapshot, brand: BrandSummary): string {
  const stats = snapshot.stages[key];
  if (key === "ingest") return brand.inCorpus > 0 ? `${brand.inCorpus} winning ads saved` : "Nothing collected yet";
  if (key === "score") return `${brand.ranked} of ${brand.inCorpus} ranked`;
  if (key === "mine") {
    return snapshot.lastMined
      ? `${snapshot.lastMined.adCount} ads · updated ${new Date(snapshot.lastMined.at).toLocaleDateString()}`
      : "No pattern report yet";
  }
  if (key === "playbook") {
    return snapshot.lastPlaybook
      ? `${snapshot.lastPlaybook.adCount} ads · updated ${new Date(snapshot.lastPlaybook.at).toLocaleDateString()}`
      : "No playbook yet";
  }
  return `${stats.done} of ${brand.inCorpus} done${stats.ready > 0 ? ` · ${stats.ready} waiting` : ""}`;
}

/**
 * The steps as a read-only checklist: what has happened, not what to press.
 * Everything that used to be a button per stage lives behind "Advanced", so the
 * normal path stays one click.
 */
export function StageStepper({ snapshot, brand, run, canRun, busy, advanced, options, onToggleAdvanced, onRunStage, onOption }: {
  snapshot: RunSnapshot;
  brand: BrandSummary;
  run: PipelineRun | null;
  canRun: boolean;
  busy: boolean;
  advanced: boolean;
  options: Record<StageKey, StageOptions>;
  onToggleAdvanced: (open: boolean) => void;
  onRunStage: (stage: StageKey) => void;
  onOption: (stage: StageKey, patch: Partial<StageOptions>) => void;
}) {
  return (
    <section className="card p-0">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">What happens when you run it</h2>
          <p className="text-xs text-ink-500">Each step picks up where the last one stopped, so nothing is done twice.</p>
        </div>
        {canRun && (
          <button type="button" className="btn btn-ghost text-xs" aria-expanded={advanced} onClick={() => onToggleAdvanced(!advanced)}>
            {advanced ? "Hide advanced" : "Advanced"}
          </button>
        )}
      </div>

      <ol className="divide-y divide-ink-100">
        {PIPELINE_STAGES.map((def, index) => {
          const state = stageState(def.key, snapshot, brand, run);
          const stats = snapshot.stages[def.key];
          const opts = options[def.key];
          const gateBlocked = def.key === "extract" && !snapshot.gate.passed && !opts.skipGate;
          return (
            <li key={def.key} className={`px-5 py-3.5 transition ${state === "active" ? "bg-brand-blush/25" : ""}`}>
              <div className="flex items-start gap-3.5">
                <StageBadge index={index + 1} state={state} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink-900">{def.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {def.key === "extract" && (stats.review ?? 0) > 0 && <Stat label="to review" value={stats.review!} tone="warn" />}
                      {stats.failed > 0 && def.key !== "ingest" && <Stat label="failed" value={stats.failed} tone="danger" />}
                      <span className="text-xs tabular-nums text-ink-500">{summaryFor(def.key, snapshot, brand)}</span>
                    </div>
                  </div>
                  {advanced && (
                    <>
                      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">{def.blurb}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <span className="rounded-full bg-brand-blush px-2 py-0.5 text-[11px] font-medium text-ink-700">{def.cost}</span>
                        {def.limits && <Segmented label="How many" value={opts.limit} options={def.limits} disabled={busy} onChange={(limit) => onOption(def.key, { limit })} />}
                        {def.lanes && <Toggle label="Redo finished ads" checked={opts.force} disabled={busy} onChange={(force) => onOption(def.key, { force })} />}
                        {def.key === "extract" && (stats.review ?? 0) > 0 && <Toggle label="Retry ads in review" checked={opts.retryReview} disabled={busy} onChange={(retryReview) => onOption(def.key, { retryReview })} />}
                        {def.key === "extract" && !snapshot.gate.passed && <Toggle label="Test mode" tone="amber" checked={opts.skipGate} disabled={busy} onChange={(skipGate) => onOption(def.key, { skipGate })} />}
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={busy || gateBlocked}
                          title={gateBlocked ? "Switch on test mode to split ads into parts before the accuracy check has passed." : undefined}
                          onClick={() => onRunStage(def.key)}
                        >
                          <PlayIcon className="h-3 w-3" />Run this step
                        </button>
                      </div>
                      <p className="mt-2 font-mono text-[11px] text-ink-400">{def.cli.replace("<brand>", brand.domain)}</p>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
