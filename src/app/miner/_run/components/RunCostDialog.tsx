"use client";

import { useEffect, useState } from "react";
import { estimateRun, formatMinutes, formatUsdRange } from "@/lib/cellumove/corpus/estimate";
import type { BrandSummary, PipelineOptions, RunSnapshot } from "../types";
import { Segmented } from "./controls";
import { AlertIcon, PlayIcon } from "./icons";

const RECENT_PICK_MS = 7 * 24 * 60 * 60 * 1000;

function sinceLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return "collected today";
  return days === 1 ? "collected yesterday" : `collected ${days} days ago`;
}

/**
 * One confirmation before a run: what it will cost, how long it takes, and —
 * the big time saver — whether to pay for a fresh pull at all when this brand
 * was collected recently.
 */
export function RunCostDialog({ brand, snapshot, onConfirm, onCancel }: {
  brand: BrandSummary;
  snapshot: RunSnapshot;
  onConfirm: (options: PipelineOptions) => void;
  onCancel: () => void;
}) {
  const collectedRecently = Boolean(brand.lastPickedAt && Date.now() - Date.parse(brand.lastPickedAt) < RECENT_PICK_MS);
  const [includeCollect, setIncludeCollect] = useState(!(brand.inCorpus > 0 && collectedRecently));
  const [target, setTarget] = useState(snapshot.defaultTarget);
  const [acknowledged, setAcknowledged] = useState(snapshot.gate.passed);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ads = includeCollect ? target : brand.inCorpus;
  const estimate = estimateRun({ ads, includeCollect, speechOnly: snapshot.researchMode === "speech_only" });
  const blocked = !acknowledged || ads === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/35 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-labelledby="run-dialog-title" onClick={onCancel}>
      <div className="card w-full max-w-lg space-y-5 p-6 shadow-pop" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-500">Before we start</p>
          <h2 id="run-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-ink-900">{brand.name}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {brand.inCorpus > 0
              ? `${brand.inCorpus} of their ads saved${sinceLabel(brand.lastPickedAt) ? ` · ${sinceLabel(brand.lastPickedAt)}` : ""}`
              : "None of their ads collected yet"}
          </p>
        </header>

        <fieldset className="space-y-2">
          <legend className="label">Which ads</legend>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${includeCollect ? "border-ink-900 bg-ink-50" : "border-ink-200"}`}>
            <input type="radio" name="collect" className="mt-1" checked={includeCollect} onChange={() => setIncludeCollect(true)} />
            <span>
              <span className="font-medium text-ink-900">Collect fresh winners</span>
              <span className="mt-0.5 block text-ink-500">Finds the ads they are running now and makes them this brand&apos;s set. Uses BrandSearch credits.</span>
            </span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${!includeCollect ? "border-ink-900 bg-ink-50" : "border-ink-200"} ${brand.inCorpus === 0 ? "opacity-50" : ""}`}>
            <input type="radio" name="collect" className="mt-1" checked={!includeCollect} disabled={brand.inCorpus === 0} onChange={() => setIncludeCollect(false)} />
            <span>
              <span className="font-medium text-ink-900">Use the {brand.inCorpus} ads already collected</span>
              <span className="mt-0.5 block text-ink-500">Free. Carries on from where the last run stopped; anything already done is skipped.</span>
            </span>
          </label>
          {includeCollect && (
            <div className="pt-1">
              <Segmented label="How many" value={target} options={[{ label: "50", value: 50 }, { label: "100", value: 100 }, { label: "200", value: 200 }]} onChange={setTarget} />
            </div>
          )}
        </fieldset>

        <dl className="space-y-1.5 rounded-xl bg-ink-50 p-3.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">BrandSearch</dt>
            <dd className="tabular-nums text-ink-900">{estimate.credits > 0 ? `about ${estimate.credits} credits` : "none"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{snapshot.researchMode === "speech_only" ? "AI (labelling spoken copy)" : "AI (watching and labelling)"}</dt>
            <dd className="tabular-nums text-ink-900">about {formatUsdRange(estimate.usdLow, estimate.usdHigh)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Time</dt>
            <dd className="tabular-nums text-ink-900">about {formatMinutes(estimate.minutesLow, estimate.minutesHigh)}</dd>
          </div>
          {snapshot.researchMode === "speech_only" && <p className="text-xs">Missing transcripts: up to 10 regular API credits per UTC day shared across the app. Generation may take six minutes; remaining ads are deferred.</p>}
          <p className="pt-1 text-xs text-ink-400">Estimates, not quotes. Deep-dives are not included — they stay a separate button.</p>
        </dl>

        {!snapshot.gate.passed && (
          <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><AlertIcon className="h-3.5 w-3.5" />The labels are provisional</span>
              <span className="mt-0.5 block text-amber-800">{snapshot.gate.summary} Tick to run anyway and treat the labels as a first draft.</span>
            </span>
          </label>
        )}

        <p className="text-xs text-ink-500">Keep this tab open while it runs. Closing it stops after the ads in flight, and Run picks up where it left off.</p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked}
            title={blocked && ads === 0 ? "Collect some ads first." : undefined}
            onClick={() => onConfirm({ brand: brand.domain, target, includeCollect, skipGate: !snapshot.gate.passed })}
          >
            <PlayIcon className="h-3.5 w-3.5" />Start the run
          </button>
        </div>
      </div>
    </div>
  );
}
