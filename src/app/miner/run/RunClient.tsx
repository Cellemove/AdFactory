"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BatchResult, QueueItem, StepOutcome, StepResult } from "@/lib/cellumove/corpus/runner.server";
import { MinerTabs } from "../MinerTabs";

// ─── Snapshot from the server ────────────────────────────────────────────────

type StageKey = "ingest" | "media" | "transcribe" | "extract" | "score" | "mine" | "teardown";
type AdStageKey = "media" | "transcribe" | "extract" | "teardown";

type StageStats = { ready: number; done: number; failed: number; total: number; review?: number; lastRunAt?: string | null };

export type RunSnapshot = {
  totalAds: number;
  videos: number;
  brands: number;
  linksExpireAt: string | null;
  undownloaded: number;
  gate: { passed: boolean; summary: string };
  stages: Record<StageKey, StageStats>;
  pendingTeardowns: QueueItem[];
};

// ─── Stage definitions (what the writer sees) ────────────────────────────────

type StageDef = {
  key: StageKey;
  title: string;
  blurb: string;
  cost: string;
  cli: string;
  /** Per-ad stages run one request per ad on this many lanes. */
  lanes?: number;
  limits?: Array<{ label: string; value: number | null }>;
  defaultLimit?: number | null;
};

const STAGES: StageDef[] = [
  {
    key: "ingest",
    title: "Collect winning ads",
    blurb: "Picks winners from every competitor tracked in BrandSearch Spectre, spread evenly across brands: videos still running 3+ weeks after launch, highest spend first. Brands switch losing ads off within days, so survivors are the winners. The pick becomes the corpus; earlier ads are kept but set aside.",
    cost: "1 BrandSearch credit per ad",
    cli: "npm run miner:winners",
  },
  {
    key: "media",
    title: "Download the videos",
    blurb: "Saves a permanent copy of every video. BrandSearch links stop working three days after collection, so run this straight after collecting.",
    cost: "Free",
    cli: "npm run miner:media",
    lanes: 3,
    limits: [{ label: "3", value: 3 }, { label: "10", value: 10 }, { label: "All", value: null }],
    defaultLimit: null,
  },
  {
    key: "transcribe",
    title: "Transcribe voice and on-screen text",
    blurb: "Gemini watches each video and writes down what is said and what is written on screen, with timecodes. A third of the copy in this category only ever appears as on-screen text.",
    cost: "Gemini · cost shown per ad",
    cli: "npm run miner:transcribe",
    lanes: 2,
    limits: [{ label: "3", value: 3 }, { label: "10", value: 10 }, { label: "All", value: null }],
    defaultLimit: 3,
  },
  {
    key: "extract",
    title: "Break each ad into beats",
    blurb: "Labels every part of the ad — hook, qualify, pain, belief, mechanism, proof, offer — with the exact quote and timecode. A beat whose quote is not really in the ad is rejected, and the ad goes to review.",
    cost: "Gemini · cost shown per ad",
    cli: "npm run miner:extract",
    lanes: 2,
    limits: [{ label: "3", value: 3 }, { label: "10", value: 10 }, { label: "All", value: null }],
    defaultLimit: 3,
  },
  {
    key: "score",
    title: "Rank the ads",
    blurb: "Ranks every ad by how long it ran, how many variations were made, how widely it was placed and how often the idea was reused. A ranking from public signals — not real performance data.",
    cost: "Free",
    cli: "npm run miner:score",
  },
  {
    key: "mine",
    title: "Find the patterns",
    blurb: "Counts which beats are common, which order they always come in, and what the top-ranked ads do that the rest don't. Pure statistics — no AI involved.",
    cost: "Free",
    cli: "npm run miner:mine",
  },
  {
    key: "teardown",
    title: "Deep-dive the winners",
    blurb: "Sends the top-ranked ads to Teardown for its 14-part workbook: avatar psychology, hook, proof, offer and what to borrow. A read for strategists — it does not feed the patterns.",
    cost: "≈ $0.15–0.20 per ad",
    cli: "npm run miner:teardown",
    lanes: 3,
    limits: [{ label: "Top 25%", value: null }, { label: "Top 20", value: 20 }, { label: "All ranked", value: 1000 }],
    defaultLimit: null,
  },
];

// ─── Run state ───────────────────────────────────────────────────────────────

type RowStatus = "waiting" | "running" | StepOutcome;
type RunRow = QueueItem & { status: RowStatus; detail?: string; costUsd?: number | null };
type Phase = "loading" | "running" | "watching" | "finished" | "stopped" | "error";
type RunState = { phase: Phase; rows: RunRow[]; startedAt: number; finishedAt?: number; error?: string; batch?: BatchResult };

type Options = { limit: number | null; force: boolean; retryReview: boolean; skipGate: boolean; target: number };

const SETTLED: RowStatus[] = ["done", "skipped", "failed", "quarantined"];
const TEARDOWN_POLL_MS = 15_000;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/miner/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload as T;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function money(value: number): string {
  return value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function untilLabel(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function Icon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>{children}</svg>;
}
const CheckIcon = (p: { className?: string }) => <Icon {...p}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></Icon>;
const CrossIcon = (p: { className?: string }) => <Icon {...p}><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></Icon>;
const ClockIcon = (p: { className?: string }) => <Icon {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6.5V10l2.5 1.5" /></Icon>;
const AlertIcon = (p: { className?: string }) => <Icon {...p}><path d="M10 3.5l7 12.5H3L10 3.5z" /><path d="M10 8.5v3M10 14h.01" /></Icon>;
const PlayIcon = (p: { className?: string }) => <Icon {...p}><path d="M6.5 4.5l9 5.5-9 5.5v-11z" fill="currentColor" stroke="none" /></Icon>;
const StopIcon = (p: { className?: string }) => <Icon {...p}><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></Icon>;
const ArrowIcon = (p: { className?: string }) => <Icon {...p}><path d="M5 10h10M11 6l4 4-4 4" /></Icon>;

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 20 20" aria-hidden className={`animate-spin motion-reduce:animate-none ${className}`}><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} /><path d="M17 10a7 7 0 0 0-7-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg>;
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "running") return <Spinner className="h-4 w-4 text-ink-700" />;
  if (status === "done") return <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckIcon className="h-3.5 w-3.5" /></span>;
  if (status === "failed") return <span className="grid h-5 w-5 place-items-center rounded-full bg-red-50 text-red-600"><CrossIcon className="h-3.5 w-3.5" /></span>;
  if (status === "quarantined") return <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-50 text-amber-600"><AlertIcon className="h-3.5 w-3.5" /></span>;
  if (status === "queued" || status === "processing") return <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-blush text-ink-700"><ClockIcon className="h-3.5 w-3.5" /></span>;
  if (status === "skipped") return <span className="grid h-5 w-5 place-items-center text-ink-300">–</span>;
  return <span className="block h-2 w-2 rounded-full border border-ink-300" />;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  waiting: "Not started", running: "Working…", done: "Done", skipped: "Skipped", failed: "Failed",
  quarantined: "Needs review", queued: "Queued", processing: "Processing",
};

// ─── Small controls ──────────────────────────────────────────────────────────

function Segmented<T extends string | number | null>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ label: string; value: T }>; onChange: (value: T) => void; disabled?: boolean }) {
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

function Toggle({ label, checked, onChange, disabled, tone = "ink" }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; tone?: "ink" | "amber" }) {
  return (
    <label className={`inline-flex select-none items-center gap-2 text-xs font-medium ${disabled ? "cursor-not-allowed text-ink-400" : "cursor-pointer text-ink-600"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={`relative h-[18px] w-8 shrink-0 rounded-full bg-ink-200 transition after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-3.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ink-900 peer-focus-visible:ring-offset-1 ${tone === "amber" ? "peer-checked:bg-amber-500" : "peer-checked:bg-ink-900"}`} />
      {label}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ink" | "ok" | "warn" | "danger" }) {
  const tones = {
    ink: "border-ink-200 bg-ink-50 text-ink-700",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  } as const;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}><span className="font-semibold tabular-nums">{value}</span>{label}</span>;
}

function ProgressBar({ value, max, live }: { value: number; max: number; live?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full bg-gradient-to-r from-brand-pink to-ink-800 transition-[width] duration-500 ease-out ${live ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Funnel ──────────────────────────────────────────────────────────────────

function Funnel({ snapshot }: { snapshot: RunSnapshot }) {
  const s = snapshot.stages;
  const items = [
    { label: "Winners", value: snapshot.videos, of: null, note: `in the corpus · ${snapshot.brands} brands` },
    { label: "Downloaded", value: s.media.done, of: snapshot.videos, note: null },
    { label: "Transcribed", value: s.transcribe.done, of: snapshot.videos, note: null },
    { label: "In beats", value: s.extract.done, of: snapshot.videos, note: s.extract.review ? `${s.extract.review} in review` : null },
    { label: "Ranked", value: s.score.done, of: snapshot.totalAds, note: null },
    { label: "Torn down", value: s.teardown.done, of: s.teardown.total || null, note: "top winners" },
  ];
  return (
    <section aria-label="Corpus progress" className="card overflow-hidden p-0">
      <ol className="grid grid-cols-2 gap-px bg-ink-100 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.label} className="bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-400">{item.label}</div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink-900">{item.value}</span>
              {item.of != null && <span className="text-sm tabular-nums text-ink-400">/ {item.of}</span>}
            </div>
            {item.of != null && <div className="mt-2"><ProgressBar value={item.value} max={item.of} /></div>}
            {item.note && <div className="mt-1.5 text-xs text-ink-500">{item.note}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function RunClient({ snapshot, canRun }: { snapshot: RunSnapshot; canRun: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState<StageKey | null>(null);
  const [runs, setRuns] = useState<Partial<Record<StageKey, RunState>>>({});
  const [options, setOptions] = useState<Record<StageKey, Options>>(() => Object.fromEntries(
    STAGES.map((stage) => [stage.key, { limit: stage.defaultLimit ?? null, force: false, retryReview: false, skipGate: false, target: 100 }]),
  ) as Record<StageKey, Options>);
  const [confirmIngest, setConfirmIngest] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);

  /** A sleep that Stop cuts short, so stopping never waits out a poll interval. */
  const sleep = useCallback((ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wakeRef.current = null; resolve(); }, ms);
    wakeRef.current = () => { clearTimeout(timer); wakeRef.current = null; resolve(); };
  }), []);

  const stop = useCallback(() => {
    stopRef.current = true;
    setStopping(true);
    wakeRef.current?.();
  }, []);

  const patchRun = useCallback((stage: StageKey, patch: Partial<RunState> | ((run: RunState) => Partial<RunState>)) => {
    setRuns((current) => {
      const run = current[stage] ?? { phase: "loading", rows: [], startedAt: Date.now() };
      return { ...current, [stage]: { ...run, ...(typeof patch === "function" ? patch(run) : patch) } };
    });
  }, []);

  const patchRow = useCallback((stage: StageKey, id: string, patch: Partial<RunRow>) => {
    patchRun(stage, (run) => ({ rows: run.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) }));
  }, [patchRun]);

  // Tick the elapsed clock and the link-expiry countdown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [active]);

  // Leaving mid-run stops after the ads in flight; warn before that happens.
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  const watchTeardowns = useCallback(async (ids: string[]) => {
    patchRun("teardown", { phase: "watching" });
    let pending = ids;
    while (pending.length && !stopRef.current) {
      await sleep(TEARDOWN_POLL_MS);
      if (stopRef.current) break;
      try {
        const { results } = await call<{ results: StepResult[] }>({ action: "sync-teardowns", adIds: pending });
        for (const result of results) patchRow("teardown", result.adId, { status: result.outcome, detail: result.detail, costUsd: result.costUsd });
        pending = results.filter((result) => result.outcome === "queued" || result.outcome === "processing").map((result) => result.adId);
      } catch {
        // Teardown or the network hiccuped; keep watching.
      }
    }
    return pending.length === 0;
  }, [patchRow, patchRun, sleep]);

  const finish = useCallback((stage: StageKey, phase: Phase, extra: Partial<RunState> = {}) => {
    patchRun(stage, { phase, finishedAt: Date.now(), ...extra });
    setActive(null);
    setStopping(false);
    router.refresh();
  }, [patchRun, router]);

  const runAdStage = useCallback(async (stage: AdStageKey) => {
    const def = STAGES.find((item) => item.key === stage)!;
    const opts = options[stage];
    stopRef.current = false;
    setActive(stage);
    setRuns((current) => ({ ...current, [stage]: { phase: "loading", rows: [], startedAt: Date.now() } }));

    let items: QueueItem[];
    try {
      ({ items } = await call<{ items: QueueItem[] }>({ action: "queue", stage, limit: opts.limit, force: opts.force, retryReview: stage === "extract" ? opts.retryReview : undefined }));
    } catch (error) {
      finish(stage, "error", { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!items.length) {
      finish(stage, "finished");
      return;
    }
    patchRun(stage, { phase: "running", rows: items.map((item) => ({ ...item, status: "waiting" as const })) });

    let cursor = 0;
    const lane = async () => {
      while (!stopRef.current && cursor < items.length) {
        const item = items[cursor++]!;
        patchRow(stage, item.id, { status: "running" });
        try {
          const result = await call<StepResult>({
            action: "step", stage, adId: item.id, force: opts.force,
            ...(stage === "extract" ? { retryReview: opts.retryReview, skipGate: opts.skipGate } : {}),
          });
          patchRow(stage, item.id, { status: result.outcome, detail: result.detail, costUsd: result.costUsd });
        } catch (error) {
          patchRow(stage, item.id, { status: "failed", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(def.lanes ?? 2, items.length) }, lane));

    if (stage === "teardown" && !stopRef.current) {
      const sent = items.map((item) => item.id);
      await watchTeardowns(sent);
    }
    finish(stage, stopRef.current ? "stopped" : "finished");
  }, [finish, options, patchRow, patchRun, watchTeardowns]);

  const runBatch = useCallback(async (stage: "ingest" | "score" | "mine") => {
    setActive(stage);
    setConfirmIngest(false);
    setRuns((current) => ({ ...current, [stage]: { phase: "running", rows: [], startedAt: Date.now() } }));
    try {
      const batch = await call<BatchResult>(stage === "ingest" ? { action: "winners", target: options.ingest.target } : { action: stage });
      finish(stage, "finished", { batch });
    } catch (error) {
      finish(stage, "error", { error: error instanceof Error ? error.message : String(error) });
    }
  }, [finish, options.ingest.target]);

  // Teardowns submitted earlier (this tab or the CLI) are still running: pick them back up.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !canRun || !snapshot.pendingTeardowns.length) return;
    resumed.current = true;
    stopRef.current = false;
    setActive("teardown");
    setRuns((current) => ({ ...current, teardown: { phase: "watching", startedAt: Date.now(), rows: snapshot.pendingTeardowns.map((item) => ({ ...item, status: "processing" as const, detail: "Waiting for Teardown…" })) } }));
    void watchTeardowns(snapshot.pendingTeardowns.map((item) => item.id)).then(() => finish("teardown", stopRef.current ? "stopped" : "finished"));
  }, [canRun, finish, snapshot.pendingTeardowns, watchTeardowns]);

  const setOption = (stage: StageKey, patch: Partial<Options>) => setOptions((current) => ({ ...current, [stage]: { ...current[stage], ...patch } }));

  const expiry = snapshot.linksExpireAt && snapshot.undownloaded > 0 ? untilLabel(snapshot.linksExpireAt, now) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MinerTabs active="run" />
        <Link href="/miner" className="inline-flex items-center gap-1 text-sm text-ink-500 transition hover:text-ink-900">Pattern report & corpus table <ArrowIcon className="h-3.5 w-3.5" /></Link>
      </div>

      <header className="max-w-3xl">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-500"><span className="h-1.5 w-1.5 rounded-full bg-brand-pink" />Corpus Miner</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">Run the pipeline</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-500">From our competitors&apos; winning ads to mined patterns in seven steps. Work top to bottom: each step only picks up ads the step before it has finished, and running a step again simply continues where it left off.</p>
      </header>

      <Funnel snapshot={snapshot} />

      <div className="space-y-3">
        {expiry && (
          <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${expiry === "expired" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50/80 text-amber-900"}`}>
            <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {expiry === "expired"
                ? <><strong className="font-semibold">Video links have expired</strong> for {snapshot.undownloaded} ad{snapshot.undownloaded === 1 ? "" : "s"} that were never downloaded. Collect ads again to refresh them.</>
                : <><strong className="font-semibold">Video links expire in {expiry}</strong> · {new Date(snapshot.linksExpireAt!).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Download the {snapshot.undownloaded} remaining video{snapshot.undownloaded === 1 ? "" : "s"} before then.</>}
            </p>
          </div>
        )}
        {!canRun && (
          <div className="flex items-start gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <p>View only. Running steps costs credits and model spend, so only creative strategists can start them.</p>
          </div>
        )}
      </div>

      <ol className="relative">
        {STAGES.map((def, index) => {
          const stats = snapshot.stages[def.key];
          const run = runs[def.key];
          const opts = options[def.key];
          const isActive = active === def.key;
          const busy = active !== null;
          const isAdStage = Boolean(def.lanes);
          const complete = isAdStage ? stats.ready === 0 && stats.done > 0 : stats.done > 0 && stats.ready === 0;
          const gateBlocked = def.key === "extract" && !snapshot.gate.passed && !opts.skipGate;
          const nothingToDo = isAdStage && stats.ready === 0 && !opts.force
            && !(def.key === "extract" && opts.retryReview && (stats.review ?? 0) > 0)
            && !(def.key === "teardown" && opts.limit !== null);
          const last = index === STAGES.length - 1;

          return (
            <li key={def.key} className="relative pb-5 pl-14 last:pb-0">
              {!last && <span aria-hidden className="absolute bottom-0 left-[21px] top-12 w-px bg-gradient-to-b from-ink-200 to-ink-200/40" />}
              <span
                aria-hidden
                className={`absolute left-0 top-4 grid h-11 w-11 place-items-center rounded-full border text-sm font-semibold transition ${
                  isActive ? "border-brand-pink bg-white text-ink-900 ring-4 ring-brand-pink/20"
                    : complete ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-200 bg-white text-ink-500"
                }`}
              >
                {isActive ? <Spinner className="h-4 w-4 text-ink-800" /> : complete ? <CheckIcon className="h-4 w-4" /> : index + 1}
              </span>

              <article className={`card p-5 transition duration-300 ${isActive ? "shadow-card-hover ring-2 ring-brand-pink/30" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink-900">{def.title}</h2>
                      <span className="rounded-full bg-brand-blush px-2 py-0.5 text-[11px] font-medium text-ink-700">{def.cost}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{def.blurb}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {def.key === "ingest" ? <><Stat label="winners in corpus" value={stats.done} tone="ok" />{snapshot.brands > 0 && <Stat label="competitors" value={snapshot.brands} tone="ink" />}</>
                      : def.key === "score" ? <><Stat label="ranked" value={stats.done} tone="ok" />{stats.ready > 0 && <Stat label="unranked" value={stats.ready} tone="ink" />}</>
                        : def.key === "mine" ? <><Stat label="ads in last report" value={stats.done} tone="ok" />{stats.ready > 0 && <Stat label="new since" value={stats.ready} tone="warn" />}</>
                          : <>
                            <Stat label="ready" value={stats.ready} tone="ink" />
                            <Stat label="done" value={stats.done} tone="ok" />
                            {(stats.review ?? 0) > 0 && <Stat label="in review" value={stats.review!} tone="warn" />}
                            {stats.failed > 0 && <Stat label="failed" value={stats.failed} tone="danger" />}
                          </>}
                  </div>
                </div>

                {def.key === "extract" && !snapshot.gate.passed && (
                  <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-xs text-amber-900">
                    <AlertIcon className="mt-px h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Accuracy check not passed yet</p>
                      <p className="mt-0.5 text-amber-800">{snapshot.gate.summary} Beats made now are a test of the pipeline, not trustworthy labels.</p>
                    </div>
                  </div>
                )}

                {canRun && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-ink-100 pt-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                      {def.limits && (
                        <Segmented label={def.key === "teardown" ? "Which" : "How many"} value={opts.limit} options={def.limits} disabled={busy} onChange={(limit) => setOption(def.key, { limit })} />
                      )}
                      {def.key === "ingest" && (
                        <Segmented label="How many winners" value={opts.target} options={[{ label: "50", value: 50 }, { label: "100", value: 100 }, { label: "200", value: 200 }]} disabled={busy} onChange={(target) => setOption("ingest", { target })} />
                      )}
                      {isAdStage && <Toggle label="Redo finished ads" checked={opts.force} disabled={busy} onChange={(force) => setOption(def.key, { force })} />}
                      {def.key === "extract" && (stats.review ?? 0) > 0 && <Toggle label="Retry ads in review" checked={opts.retryReview} disabled={busy} onChange={(retryReview) => setOption("extract", { retryReview })} />}
                      {def.key === "extract" && !snapshot.gate.passed && <Toggle label="Test mode" tone="amber" checked={opts.skipGate} disabled={busy} onChange={(skipGate) => setOption("extract", { skipGate })} />}
                    </div>

                    <div className="flex items-center gap-2">
                      {isActive ? (
                        <button type="button" className="btn" disabled={stopping} onClick={stop}>
                          {stopping ? <><Spinner className="h-3.5 w-3.5" />Stopping…</> : <><StopIcon className="h-3.5 w-3.5" />{run?.phase === "watching" ? "Stop watching" : "Stop"}</>}
                        </button>
                      ) : def.key === "ingest" && confirmIngest ? (
                        <>
                          <span className="text-xs text-ink-500">Uses about {opts.target} credits and replaces the corpus</span>
                          <button type="button" className="btn btn-ghost" onClick={() => setConfirmIngest(false)}>Cancel</button>
                          <button type="button" className="btn btn-primary" onClick={() => void runBatch("ingest")}>Confirm</button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy || gateBlocked || nothingToDo}
                          title={gateBlocked ? "Turn on test mode to extract before the accuracy check passes." : nothingToDo ? "Nothing is waiting for this step." : undefined}
                          onClick={() => {
                            if (def.key === "ingest") setConfirmIngest(true);
                            else if (def.key === "score" || def.key === "mine") void runBatch(def.key);
                            else void runAdStage(def.key as AdStageKey);
                          }}
                        >
                          <PlayIcon className="h-3.5 w-3.5" />{nothingToDo ? "Up to date" : "Run"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {run && <RunPanel stage={def.key} run={run} now={now} />}

                <p className="mt-4 font-mono text-[11px] text-ink-400">Terminal: {def.cli}</p>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Live run panel ──────────────────────────────────────────────────────────

function RunPanel({ stage, run, now }: { stage: StageKey; run: RunState; now: number }) {
  const settled = run.rows.filter((row) => SETTLED.includes(row.status)).length;
  const inFlight = run.rows.filter((row) => row.status === "running").length;
  const counts = {
    done: run.rows.filter((row) => row.status === "done").length,
    failed: run.rows.filter((row) => row.status === "failed").length,
    review: run.rows.filter((row) => row.status === "quarantined").length,
    waiting: run.rows.filter((row) => row.status === "waiting").length,
    teardown: run.rows.filter((row) => row.status === "queued" || row.status === "processing").length,
  };
  const cost = run.rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const elapsed = clock((run.finishedAt ?? now) - run.startedAt);
  const live = run.phase === "running" || run.phase === "loading" || run.phase === "watching";
  const progressDone = stage === "teardown" ? counts.done + counts.failed : settled;

  let headline: string;
  if (run.phase === "loading") headline = "Finding ads that are ready…";
  else if (run.phase === "error") headline = "Could not run this step";
  else if (run.phase === "running" && !run.rows.length) headline = "Working…";
  else if (run.phase === "running") headline = `${stage === "teardown" ? "Sending" : "Processing"} ${Math.min(settled + inFlight, run.rows.length)} of ${run.rows.length}`;
  else if (run.phase === "watching") headline = `Teardown is working on ${counts.teardown} ad${counts.teardown === 1 ? "" : "s"} · checking every ${TEARDOWN_POLL_MS / 1000}s`;
  else if (run.phase === "stopped") headline = stage === "teardown" && counts.teardown ? "Stopped watching — Teardown keeps going; results appear next time you open this page" : `Stopped · ${counts.waiting} not started`;
  else if (run.batch) headline = run.batch.title;
  else if (!run.rows.length) headline = "Nothing was waiting for this step";
  else headline = "Finished";

  return (
    <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/60 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
          {live ? <Spinner className="h-4 w-4 text-ink-700" /> : run.phase === "error" ? <CrossIcon className="h-4 w-4 text-red-600" /> : <CheckIcon className="h-4 w-4 text-emerald-600" />}
          {headline}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-500">
          {counts.done > 0 && <span className="text-emerald-700">{counts.done} done</span>}
          {counts.review > 0 && <span className="text-amber-700">{counts.review} to review</span>}
          {counts.failed > 0 && <span className="text-red-700">{counts.failed} failed</span>}
          {cost > 0 && <span>{money(cost)}</span>}
          <span>{elapsed}</span>
        </div>
      </div>

      {run.rows.length > 0 && <div className="mt-3"><ProgressBar value={progressDone} max={run.rows.length} live={live} /></div>}
      {run.error && <p className="mt-3 text-sm text-red-700">{run.error}</p>}
      {run.batch && (
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          {run.batch.lines.map((line) => <li key={line}>{line}</li>)}
          {stage === "mine" && run.batch.title.startsWith("Patterns") && <li><Link href="/miner#pattern-report" className="inline-flex items-center gap-1 font-medium text-ink-900 hover:underline">Open the pattern report <ArrowIcon className="h-3.5 w-3.5" /></Link></li>}
        </ul>
      )}

      {run.rows.length > 0 && (
        <ul className="mt-3 max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 bg-white">
          {run.rows.map((row) => (
            <li key={row.id} className={`grid grid-cols-[1.25rem_minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm transition-colors ${row.status === "running" ? "bg-brand-blush/40" : ""}`}>
              <StatusIcon status={row.status} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-900">{row.brandName}</div>
                <Link href={`/miner/${row.id}`} className="block truncate font-mono text-[11px] text-ink-400 hover:text-ink-700 hover:underline">{row.id}</Link>
              </div>
              <div className={`min-w-0 truncate text-xs ${row.status === "failed" ? "text-red-700" : row.status === "quarantined" ? "text-amber-800" : "text-ink-500"}`} title={row.detail}>
                {row.detail ?? STATUS_LABEL[row.status]}
              </div>
              <div className="text-right text-xs tabular-nums text-ink-400">{row.costUsd ? money(row.costUsd) : null}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
