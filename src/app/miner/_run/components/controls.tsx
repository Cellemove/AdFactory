"use client";

import { stageDef } from "../stages";
import type { PipelineRun, RowStatus, StageKey } from "../types";
import { stageShare } from "../progress";
import { AlertIcon, CheckIcon, ClockIcon, CrossIcon, Spinner } from "./icons";

export function Segmented<T extends string | number | null>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-ink-500">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-ink-200 bg-ink-50 p-0.5">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums transition duration-150 disabled:cursor-not-allowed ${option.value === value ? "bg-white text-ink-900 shadow-sm ring-1 ring-ink-200" : "text-ink-500 hover:text-ink-900"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, disabled, tone = "ink" }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: "ink" | "amber";
}) {
  return (
    <label className={`inline-flex select-none items-center gap-2 text-xs font-medium ${disabled ? "cursor-not-allowed text-ink-400" : "cursor-pointer text-ink-600"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={`relative h-[18px] w-8 shrink-0 rounded-full bg-ink-200 transition after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-3.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ink-900 peer-focus-visible:ring-offset-1 ${tone === "amber" ? "peer-checked:bg-amber-500" : "peer-checked:bg-ink-900"}`} />
      {label}
    </label>
  );
}

export function ProgressBar({ value, max, live, className = "h-1.5" }: { value: number; max: number; live?: boolean; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`w-full overflow-hidden rounded-full bg-ink-100 ${className}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div
        className={`h-full rounded-full bg-gradient-to-r from-brand-pink to-ink-800 transition-[width] duration-500 ease-out ${live ? "animate-pulse motion-reduce:animate-none" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** The overall bar: one segment per stage, each sized by its weight. */
export function SegmentedProgress({ run, live }: { run: Pick<PipelineRun, "order" | "stages">; live?: boolean }) {
  const total = run.order.reduce((sum, key) => sum + stageDef(key).weight, 0) || 1;
  return (
    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-ink-100" role="presentation">
      {run.order.map((key) => {
        const progress = run.stages[key];
        const share = progress ? stageShare(progress) : 0;
        return (
          <div key={key} className="relative h-full overflow-hidden bg-ink-100" style={{ width: `${(stageDef(key).weight / total) * 100}%` }} title={stageDef(key).title}>
            <div
              className={`h-full rounded-full bg-gradient-to-r from-brand-pink to-ink-800 transition-[width] duration-500 ease-out ${live && progress?.status === "running" ? "animate-pulse motion-reduce:animate-none" : ""}`}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, tone = "ink" }: { label: string; value: number | string; tone?: "ink" | "ok" | "warn" | "danger" }) {
  const tones = {
    ink: "border-ink-200 bg-ink-50 text-ink-700",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>
      <span className="font-semibold tabular-nums">{value}</span>{label}
    </span>
  );
}

export function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "running") return <Spinner className="h-4 w-4 text-ink-700" />;
  if (status === "done") return <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckIcon className="h-3.5 w-3.5" /></span>;
  if (status === "failed") return <span className="grid h-5 w-5 place-items-center rounded-full bg-red-50 text-red-600"><CrossIcon className="h-3.5 w-3.5" /></span>;
  if (status === "quarantined") return <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-50 text-amber-600"><AlertIcon className="h-3.5 w-3.5" /></span>;
  if (status === "queued" || status === "processing") return <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-blush text-ink-700"><ClockIcon className="h-3.5 w-3.5" /></span>;
  if (status === "skipped") return <span className="grid h-5 w-5 place-items-center text-ink-300">–</span>;
  return <span className="block h-2 w-2 rounded-full border border-ink-300" />;
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  waiting: "Not started",
  running: "Working…",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
  quarantined: "Needs a look",
  queued: "Queued",
  processing: "Processing",
};

/** The numbered circle in the stage list. */
export function StageBadge({ index, state }: { index: number; state: "idle" | "active" | "complete" | "attention" }) {
  const base = "grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-semibold transition";
  if (state === "active") return <span aria-hidden className={`${base} border-brand-pink bg-white text-ink-900 ring-4 ring-brand-pink/20`}><Spinner className="h-4 w-4 text-ink-800" /></span>;
  if (state === "complete") return <span aria-hidden className={`${base} border-ink-900 bg-ink-900 text-white`}><CheckIcon className="h-4 w-4" /></span>;
  if (state === "attention") return <span aria-hidden className={`${base} border-amber-300 bg-amber-50 text-amber-700`}><AlertIcon className="h-4 w-4" /></span>;
  return <span aria-hidden className={`${base} border-ink-200 bg-white text-ink-500`}>{index}</span>;
}

export function stageKeyLabel(key: StageKey): string {
  return stageDef(key).title;
}
