"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { runPipelineStage, runDeepDivePass, type StageVerification } from "../../actions/pipeline-run";
import { predictScriptsRoas, type RoasEstimate } from "../../actions/roas-predict";
import {
  PIPELINE_STAGES,
  DEEP_DIVE_DEPTHS,
  type PipelineStageKey,
  type DeepDiveDepth,
} from "@/lib/cellumove/pipeline-stages";

interface DeepDiveProgressState {
  collected: number;
  target: number;
  passes: number;
}

interface G1 {
  painPoints: string;
  desires: string;
  objections: string;
  dailyLanguage: string;
  triggers: string;
  identity: string;
  socialProof: string;
  buyingContext: string;
}

type Outputs = Record<string, unknown>;

// Inline spinner that inherits the current text color (works on dark/light buttons).
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4z" />
    </svg>
  );
}

// Ticking elapsed timer — restarts whenever `activeKey` changes, 0 when idle.
// A live counter is the clearest possible signal that work is actually happening.
function useElapsedMs(activeKey: string | null): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeKey) {
      setMs(0);
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    setMs(0);
    const id = setInterval(() => {
      if (startRef.current != null) setMs(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [activeKey]);
  return ms;
}

function formatElapsed(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

type Verifications = Record<string, StageVerification | undefined>;

export function PipelineStepper({
  runId,
  avatarName,
  angleName,
  g1,
  initialOutputs,
  initialVerifications,
}: {
  runId: string;
  avatarName: string;
  angleName: string;
  g1: G1 | null;
  initialOutputs: Outputs;
  initialVerifications?: Verifications;
}) {
  const [outputs, setOutputs] = useState<Outputs>(initialOutputs ?? {});
  const [verifications, setVerifications] = useState<Verifications>(initialVerifications ?? {});
  const [running, setRunning] = useState<PipelineStageKey | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<PipelineStageKey, string>>>({});
  const [, startTransition] = useTransition();
  const autoStarted = useRef(false);

  // Deep-dive (G2) progressive scrape: depth tier + live progress + stop flag.
  const [deepDiveDepth, setDeepDiveDepth] = useState<DeepDiveDepth>("soft");
  const [ddProgress, setDdProgress] = useState<DeepDiveProgressState | null>(() => {
    const dd = (initialOutputs ?? {}).deepDive as
      | { kind?: string; threads?: unknown[]; target?: number; passes?: number }
      | undefined;
    return dd?.kind === "progressive"
      ? { collected: dd.threads?.length ?? 0, target: dd.target ?? 0, passes: dd.passes ?? 0 }
      : null;
  });
  const [ddLooping, setDdLooping] = useState(false);
  const stopRef = useRef(false);
  const ddLoopingRef = useRef(false); // synchronous re-entrancy guard (state lags a tick)

  // A stage counts as "done" for gating downstream. The deep dive only counts once
  // its progressive accumulator has finished (not after the first partial pass); a
  // legacy single-shot deep dive (pre-progressive shape) counts as complete.
  const isDone = (k: PipelineStageKey) => {
    if (k === "deepDive") {
      const dd = outputs.deepDive as { kind?: string; done?: boolean } | undefined;
      if (dd == null) return false;
      return dd.kind !== "progressive" || dd.done === true;
    }
    return outputs[k] != null;
  };
  const isReady = (k: PipelineStageKey) =>
    PIPELINE_STAGES.find((s) => s.key === k)!.needs.every((n) => isDone(n));

  const run = (k: PipelineStageKey) => {
    setRunning(k);
    setErrors((e) => ({ ...e, [k]: undefined }));
    startTransition(async () => {
      try {
        const { output, verification } = await runPipelineStage(runId, k);
        setOutputs((o) => ({ ...o, [k]: output }));
        setVerifications((v) => ({ ...v, [k]: verification }));
      } catch (err) {
        setErrors((e) => ({ ...e, [k]: err instanceof Error ? err.message : String(err) }));
      } finally {
        setRunning(null);
      }
    });
  };

  // Auto-loop the deep dive's progressive passes until it hits the tier target
  // (or stops/errors). Every pass persists server-side, so it's resumable.
  const runDeepDiveLoop = () => {
    if (ddLoopingRef.current) return; // atomic guard — survives same-tick double-invoke
    ddLoopingRef.current = true;
    stopRef.current = false;
    setDdLooping(true);
    setRunning("deepDive");
    setErrors((e) => ({ ...e, deepDive: undefined }));
    (async () => {
      try {
        let done = false;
        let guard = 0;
        const guardMax = DEEP_DIVE_DEPTHS[deepDiveDepth].maxPasses + 5;
        while (!done && !stopRef.current && guard < guardMax) {
          guard++;
          const p = await runDeepDivePass(runId, deepDiveDepth);
          setOutputs((o) => ({ ...o, deepDive: p.output }));
          setDdProgress({ collected: p.collected, target: p.target, passes: p.passes });
          if (p.verification) setVerifications((v) => ({ ...v, deepDive: p.verification }));
          done = p.done;
        }
      } catch (err) {
        setErrors((e) => ({ ...e, deepDive: err instanceof Error ? err.message : String(err) }));
      } finally {
        setRunning(null);
        setDdLooping(false);
        ddLoopingRef.current = false;
      }
    })();
  };
  const stopDeepDive = () => {
    stopRef.current = true;
  };

  // Run every not-yet-built stage in order, each feeding the next — no clicking.
  // Stops the chain if a stage errors so we don't run downstream on bad context.
  // The deep dive (G2) loops its passes to completion before moving on.
  const runAll = () => {
    setAutoRunning(true);
    stopRef.current = false;
    startTransition(async () => {
      let acc: Outputs = { ...outputs };
      const builtAlready = (key: PipelineStageKey) => {
        if (key !== "deepDive") return acc[key] != null;
        const dd = acc.deepDive as { kind?: string; done?: boolean; target?: number } | undefined;
        if (dd == null) return false;
        if (dd.kind !== "progressive") return true; // legacy single-shot → already built
        // Done AND matches the selected tier — else re-mine to the new depth target.
        return dd.done === true && dd.target === DEEP_DIVE_DEPTHS[deepDiveDepth].target;
      };
      try {
        for (const s of PIPELINE_STAGES) {
          if (stopRef.current) break; // abort the chain between stages
          if (builtAlready(s.key)) continue; // already built — skip
          setRunning(s.key);
          setErrors((e) => ({ ...e, [s.key]: undefined }));
          try {
            if (s.key === "deepDive") {
              let done = false;
              let guard = 0;
              const guardMax = DEEP_DIVE_DEPTHS[deepDiveDepth].maxPasses + 5;
              while (!done && !stopRef.current && guard < guardMax) {
                guard++;
                const p = await runDeepDivePass(runId, deepDiveDepth);
                acc = { ...acc, deepDive: p.output };
                setOutputs(acc);
                setDdProgress({ collected: p.collected, target: p.target, passes: p.passes });
                if (p.verification) setVerifications((v) => ({ ...v, deepDive: p.verification }));
                done = p.done;
              }
              if (!done) break; // stopped before the deep dive finished
            } else {
              const { output, verification } = await runPipelineStage(runId, s.key);
              acc = { ...acc, [s.key]: output };
              setOutputs(acc);
              setVerifications((v) => ({ ...v, [s.key]: verification }));
            }
          } catch (err) {
            setErrors((e) => ({ ...e, [s.key]: err instanceof Error ? err.message : String(err) }));
            break; // halt the chain; downstream stages would lack this context
          }
        }
      } finally {
        setRunning(null);
        setAutoRunning(false);
      }
    });
  };

  // Optional auto-start: /pipeline/[id]?auto=1 kicks off the whole run on load,
  // so the user can launch a full pipeline from the index without clicking here.
  useEffect(() => {
    if (autoStarted.current) return;
    const auto =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("auto") === "1";
    const anyMissing = PIPELINE_STAGES.some((s) => outputs[s.key] == null);
    if (auto && anyMissing) {
      autoStarted.current = true;
      runAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selected, setSelected] = useState<string | null>(null);

  // Close the detail panel on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const doneCount = PIPELINE_STAGES.filter((s) => isDone(s.key)).length;
  const allDone = doneCount === PIPELINE_STAGES.length;
  const busy = running !== null || autoRunning;
  const elapsed = useElapsedMs(running);

  // The stage whose full output is open in the detail panel.
  const openStage = selected && selected !== "g1" ? PIPELINE_STAGES.find((s) => s.key === selected) : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-ink-500">
            <Link href="/pipeline" className="underline hover:text-ink-900">
              Pipeline
            </Link>{" "}
            / {angleName}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{avatarName}</h1>
          <p className="text-sm text-ink-500">
            The whole build at a glance — every stage feeds the next. Click a card to open its output.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="tag">{doneCount}/{PIPELINE_STAGES.length} stages built</span>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={runAll} disabled={busy || allDone}>
              {autoRunning && <Spinner />}
              {autoRunning
                ? `Running ${running ? stageCode(running) : "…"} · ${formatElapsed(elapsed)}`
                : allDone
                  ? "All stages built"
                  : doneCount > 0
                    ? "Run remaining"
                    : "Run all stages"}
            </button>
            {autoRunning && (
              <button className="btn" onClick={() => (stopRef.current = true)} title="Stop after the current stage">
                Stop
              </button>
            )}
            <button
              className="btn"
              onClick={() => downloadAll(avatarName, angleName, g1, outputs)}
              disabled={doneCount === 0 && !g1}
              title="Download every built section as one Markdown file"
            >
              ↓ Download all
            </button>
          </div>
        </div>
      </header>

      {/* The canvas — all stages visible at once */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* G1 — Avatar Excavation (existing research) */}
        <NodeCard
          code="G1"
          title="Avatar Excavation"
          blurb="Customer research mined from the web — her real words."
          preview={g1 ? previewText(g1) : undefined}
          status={g1 ? "done" : "empty"}
          onView={g1 ? () => setSelected("g1") : undefined}
          onDownload={g1 ? () => downloadSection("G1", "Avatar Excavation", g1, avatarName) : undefined}
        />

        {/* G2 (grounded deep dive) → G3–G7 */}
        {PIPELINE_STAGES.map((s) => {
          // G2 is the progressive scrape — its own card with a depth tier + live progress.
          if (s.key === "deepDive") {
            return (
              <DeepDiveNode
                key={s.key}
                code={s.code}
                title={s.title}
                blurb={s.blurb}
                depth={deepDiveDepth}
                setDepth={setDeepDiveDepth}
                progress={ddProgress}
                output={outputs.deepDive}
                verification={isDone("deepDive") ? verifications.deepDive : undefined}
                done={isDone("deepDive")}
                looping={ddLooping || running === "deepDive"}
                elapsed={running === "deepDive" ? formatElapsed(elapsed) : undefined}
                error={errors.deepDive}
                disabled={busy && running !== "deepDive"}
                onRun={runDeepDiveLoop}
                onStop={stopDeepDive}
                onView={outputs.deepDive != null ? () => setSelected("deepDive") : undefined}
                onDownload={
                  outputs.deepDive != null
                    ? () => downloadSection("G2", "Avatar Deep Dive", outputs.deepDive, avatarName)
                    : undefined
                }
              />
            );
          }
          const done = isDone(s.key);
          const ready = isReady(s.key);
          const thisBusy = running === s.key;
          const status = thisBusy ? "running" : done ? "done" : ready ? "ready" : "locked";
          return (
            <NodeCard
              key={s.key}
              code={s.code}
              title={s.title}
              blurb={s.blurb}
              preview={done ? previewText(outputs[s.key]) : undefined}
              status={status}
              grounded={s.grounded}
              elapsed={thisBusy ? formatElapsed(elapsed) : undefined}
              needsLabel={s.needs.map((n) => stageCode(n)).join(", ")}
              error={errors[s.key]}
              verification={done ? verifications[s.key] : undefined}
              runLabel={done ? "Re-run" : s.grounded ? `Run ${s.code} · web` : `Run ${s.code}`}
              onRun={ready || done ? () => run(s.key) : undefined}
              onView={done ? () => setSelected(s.key) : undefined}
              onDownload={done ? () => downloadSection(s.code, s.title, outputs[s.key], avatarName) : undefined}
              disabled={busy}
            />
          );
        })}
      </div>

      {/* Detail panel — heavy output opens here, keeping the canvas compact */}
      {selected === "g1" && g1 && (
        <DetailModal
          code="G1"
          title="Avatar Excavation"
          onClose={() => setSelected(null)}
          onDownload={() => downloadSection("G1", "Avatar Excavation", g1, avatarName)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pain points" value={g1.painPoints} />
            <Field label="Desires" value={g1.desires} />
            <Field label="Objections" value={g1.objections} />
            <Field label="Daily language" value={g1.dailyLanguage} />
            <Field label="Triggers" value={g1.triggers} />
            <Field label="Identity" value={g1.identity} />
            <Field label="Social proof" value={g1.socialProof} />
            <Field label="Buying context" value={g1.buyingContext} />
          </div>
        </DetailModal>
      )}
      {openStage && outputs[openStage.key] != null && (
        <DetailModal
          code={openStage.code}
          title={openStage.title}
          onClose={() => setSelected(null)}
          onDownload={() => downloadSection(openStage.code, openStage.title, outputs[openStage.key], avatarName)}
        >
          {verifications[openStage.key] && <StageVerificationView v={verifications[openStage.key]!} />}
          <div className="mt-3 border-t border-ink-100 pt-3">
            {openStage.key === "deepDive" ? (
              <DeepDiveView value={outputs[openStage.key]} />
            ) : openStage.key === "rootCause" ? (
              <RootCauseSummary value={outputs[openStage.key]} />
            ) : openStage.key === "avatarIntel" ? (
              <AvatarIntelSummary value={outputs[openStage.key]} />
            ) : openStage.key === "brandDna" ? (
              <BrandDnaSummary value={outputs[openStage.key]} />
            ) : openStage.key === "copyArsenal" ? (
              <CopyArsenalSummary value={outputs[openStage.key]} />
            ) : openStage.key === "advertorial" ? (
              <AdvertorialView value={outputs[openStage.key]} />
            ) : openStage.key === "adScripts" ? (
              <AdScriptsView value={outputs[openStage.key]} />
            ) : openStage.key === "creativeBriefs" ? (
              <CreativeBriefsView value={outputs[openStage.key]} />
            ) : (
              <JsonView value={outputs[openStage.key]} />
            )}
          </div>
        </DetailModal>
      )}
    </div>
  );
}

function stageCode(k: PipelineStageKey): string {
  return PIPELINE_STAGES.find((s) => s.key === k)?.code ?? k;
}

// A generous, readable excerpt of a stage's output for the card preview — walks
// the JSON collecting the first bits of real text, whatever shape the schema is.
function previewText(value: unknown, max = 900): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (parts.join(" · ").length > max) return;
    if (v == null) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) parts.push(t);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(value);
  const joined = parts.join(" · ").replace(/\s+/g, " ");
  return joined.length > max ? joined.slice(0, max).trimEnd() + "…" : joined;
}

// ─── Canvas node — one compact card per stage ─────────────────────────────────
type NodeStatus = "done" | "ready" | "locked" | "running" | "empty";

function NodeCard({
  code,
  title,
  blurb,
  preview,
  status,
  grounded,
  elapsed,
  needsLabel,
  error,
  verification,
  runLabel,
  onRun,
  onView,
  onDownload,
  disabled,
}: {
  code: string;
  title: string;
  blurb: string;
  preview?: string;
  status: NodeStatus;
  grounded?: boolean;
  elapsed?: string;
  needsLabel?: string;
  error?: string;
  verification?: StageVerification;
  runLabel?: string;
  onRun?: () => void;
  onView?: () => void;
  onDownload?: () => void;
  disabled?: boolean;
}) {
  const running = status === "running";
  const badge =
    running
      ? "bg-brand-plum text-white animate-pulse"
      : status === "done"
        ? "bg-emerald-500 text-white"
        : status === "ready"
          ? "bg-ink-900 text-white"
          : status === "empty"
            ? "bg-amber-400 text-ink-900"
            : "bg-ink-200 text-ink-500";
  const mark = status === "done" ? "✓" : status === "locked" ? "🔒" : "";
  return (
    <div
      className={`card flex h-full flex-col transition ${
        running ? "ring-2 ring-brand-pink ring-offset-2" : status === "locked" ? "opacity-60" : ""
      } ${onView ? "cursor-pointer hover:border-ink-900" : ""}`}
      onClick={onView}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md px-1 text-xs font-semibold ${badge}`}>
          {code}
        </span>
        <h3 className="truncate text-sm font-semibold text-ink-900">{title}</h3>
        {mark && <span className="ml-auto text-xs text-ink-400">{mark}</span>}
      </div>

      {preview ? (
        <p className="mt-1.5 line-clamp-[14] text-xs leading-relaxed text-ink-600">{preview}</p>
      ) : (
        <p className="mt-1.5 line-clamp-2 text-xs text-ink-500">{blurb}</p>
      )}

      {running ? (
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-brand-plum">
            <Spinner className="h-3 w-3" /> {grounded ? "Researching" : "Generating"}… {elapsed}
          </div>
          <div className="skeleton-line h-2.5 w-full" />
          <div className="skeleton-line h-2.5 w-4/5" />
          <div className="skeleton-line h-2.5 w-2/3" />
          {grounded && <div className="text-[11px] text-ink-400">searching Reddit & reading threads — ~1–3 min</div>}
        </div>
      ) : status === "locked" ? (
        <p className="mt-2 text-xs text-ink-400">Locked — finish {needsLabel} first.</p>
      ) : status === "empty" ? (
        <p className="mt-2 text-xs text-ink-400">No research on this avatar yet.</p>
      ) : (
        <>
          {verification && <MiniVerification v={verification} />}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-3" onClick={(e) => e.stopPropagation()}>
            {onRun && (
              <button className="btn btn-primary text-xs" onClick={onRun} disabled={disabled}>
                {runLabel}
              </button>
            )}
            {onView && (
              <button className="btn text-xs" onClick={onView}>
                View →
              </button>
            )}
            {onDownload && (
              <button className="btn btn-ghost text-xs" onClick={onDownload} title="Download this section as Markdown">
                ↓ .md
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 line-clamp-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// ─── Deep Dive (G2) card — depth tier + auto-progressive scrape with live progress.
function DeepDiveNode({
  code,
  title,
  blurb,
  depth,
  setDepth,
  progress,
  output,
  verification,
  done,
  looping,
  elapsed,
  error,
  disabled,
  onRun,
  onStop,
  onView,
  onDownload,
}: {
  code: string;
  title: string;
  blurb: string;
  depth: DeepDiveDepth;
  setDepth: (d: DeepDiveDepth) => void;
  progress: DeepDiveProgressState | null;
  output: unknown;
  verification?: StageVerification;
  done: boolean;
  looping: boolean;
  elapsed?: string;
  error?: string;
  disabled?: boolean;
  onRun: () => void;
  onStop: () => void;
  onView?: () => void;
  onDownload?: () => void;
}) {
  const preview = output != null ? previewText(output) : undefined;
  const badge = looping
    ? "bg-brand-plum text-white animate-pulse"
    : done
      ? "bg-emerald-500 text-white"
      : "bg-ink-900 text-white";
  const pct =
    progress && progress.target > 0 ? Math.min(100, Math.round((progress.collected / progress.target) * 100)) : 0;

  return (
    <div
      className={`card flex h-full flex-col transition ${looping ? "ring-2 ring-brand-pink ring-offset-2" : ""} ${
        onView ? "cursor-pointer hover:border-ink-900" : ""
      }`}
      onClick={onView}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md px-1 text-xs font-semibold ${badge}`}>
          {code}
        </span>
        <h3 className="truncate text-sm font-semibold text-ink-900">{title}</h3>
        {done && <span className="ml-auto text-xs text-ink-400">✓</span>}
      </div>

      {preview ? (
        <p className="mt-1.5 line-clamp-[10] text-xs leading-relaxed text-ink-600">{preview}</p>
      ) : (
        <p className="mt-1.5 line-clamp-2 text-xs text-ink-500">{blurb}</p>
      )}

      {looping ? (
        <div className="mt-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-brand-plum">
            <Spinner className="h-3 w-3" /> Scraping… {elapsed}
          </div>
          {progress && (
            <>
              <div className="flex items-center justify-between text-[11px] text-ink-600">
                <span>
                  {progress.collected}/{progress.target} threads · pass {progress.passes}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-brand-pink transition-all" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
          <div className="text-[11px] text-ink-400">reading fresh threads each pass — runs until it hits the target</div>
          <button className="btn text-xs" onClick={onStop}>
            Stop
          </button>
        </div>
      ) : (
        <>
          {verification && <MiniVerification v={verification} />}
          {progress && !done && (
            <p className="mt-2 text-[11px] text-ink-500">
              Paused at {progress.collected}/{progress.target} threads — Run to continue.
            </p>
          )}
          <div className="mt-auto space-y-2 pt-3" onClick={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
              Depth
              <select
                className="input h-7 flex-1 py-0 text-xs"
                value={depth}
                onChange={(e) => setDepth(e.target.value as DeepDiveDepth)}
                disabled={disabled}
              >
                {(Object.keys(DEEP_DIVE_DEPTHS) as DeepDiveDepth[]).map((d) => (
                  <option key={d} value={d}>
                    {DEEP_DIVE_DEPTHS[d].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary text-xs" onClick={onRun} disabled={disabled}>
                {done ? "Re-run · web" : progress ? "Continue · web" : "Run G2 · web"}
              </button>
              {onView && (
                <button className="btn text-xs" onClick={onView}>
                  View →
                </button>
              )}
              {onDownload && (
                <button className="btn btn-ghost text-xs" onClick={onDownload} title="Download the deep dive as Markdown">
                  ↓ .md
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {error && <p className="mt-2 line-clamp-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// Compact verification indicator for a node (full detail lives in the modal).
function MiniVerification({ v }: { v: StageVerification }) {
  const c = v.claims;
  const dot =
    c.status === "clean" ? "bg-emerald-500" : c.status === "warn" ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {c.status === "clean" ? "compliant" : `${c.flags.length} claim flag${c.flags.length === 1 ? "" : "s"}`}
      {v.sourcesTotal > 0 && (
        <span className={v.sourcesOk < v.sourcesTotal ? "text-red-600" : ""}>
          · sources {v.sourcesOk}/{v.sourcesTotal}
        </span>
      )}
    </div>
  );
}

// Overlay panel that shows a stage's full output without lengthening the canvas.
function DetailModal({
  code,
  title,
  onClose,
  onDownload,
  children,
}: {
  code: string;
  title: string;
  onClose: () => void;
  onDownload?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="card my-2 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-ink-100 pb-3">
          <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md bg-ink-900 px-1 text-xs font-semibold text-white">
            {code}
          </span>
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <div className="ml-auto flex items-center gap-2">
            {onDownload && (
              <button className="btn btn-ghost text-xs" onClick={onDownload}>
                ↓ .md
              </button>
            )}
            <button className="btn text-xs" onClick={onClose}>
              ✕ Close
            </button>
          </div>
        </div>
        <div className="mt-3 max-h-[75vh] overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

// ─── Markdown export ──────────────────────────────────────────────────────────
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Render any stage's JSON output as readable Markdown — mirrors JsonView so the
// download matches what's on screen, whatever shape the schema takes.
function toMarkdown(value: unknown, depth = 0): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const allPrimitive = value.every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    if (allPrimitive) return value.map((v) => `- ${String(v)}`).join("\n");
    return value.map((v) => toMarkdown(v, depth)).join("\n\n---\n\n");
  }
  const hashes = "#".repeat(Math.min(6, depth + 3));
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => {
      const label = humanize(k);
      const inner = toMarkdown(v, depth + 1);
      return typeof v === "object" && v !== null
        ? `${hashes} ${label}\n\n${inner}`
        : `**${label}:** ${inner}`;
    })
    .join("\n\n");
}

function sectionMarkdown(code: string, title: string, value: unknown): string {
  return `# ${code} — ${title}\n\n${toMarkdown(value)}\n`;
}

function downloadSection(code: string, title: string, value: unknown, avatarName: string) {
  downloadText(`${slug(avatarName)}-${slug(code)}-${slug(title)}.md`, sectionMarkdown(code, title, value));
}

function downloadAll(avatarName: string, angleName: string, g1: unknown, outputs: Outputs) {
  const parts: string[] = [`# ${avatarName} — Pipeline (${angleName})\n`];
  if (g1) parts.push(sectionMarkdown("G1", "Avatar Excavation", g1));
  // G2 (deep dive) and G3–G7 all live in outputs now.
  for (const s of PIPELINE_STAGES) {
    if (outputs[s.key] != null) parts.push(sectionMarkdown(s.code, s.title, outputs[s.key]));
  }
  downloadText(`${slug(avatarName)}-pipeline.md`, parts.join("\n\n"));
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{value}</div>
    </div>
  );
}

// ─── Verification (compliance + source liveness) for a generated stage ────────
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function StageVerificationView({ v }: { v: StageVerification }) {
  const c = v.claims;
  const claimCls =
    c.status === "clean" ? "tag tag-ok" : c.status === "warn" ? "tag tag-warn" : "tag tag-danger";
  const claimLabel =
    c.status === "clean"
      ? "compliance ✓"
      : c.status === "warn"
        ? `${c.flags.length} soft claim${c.flags.length === 1 ? "" : "s"}`
        : `${c.flags.length} claim flag${c.flags.length === 1 ? "" : "s"}`;
  const dead = v.sources.filter((s) => !s.ok);
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-ink-200 bg-ink-50/60 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">verification</span>
        <span className={claimCls} title="Deterministic claim scan of the generated copy">
          {claimLabel}
        </span>
        {v.sourcesTotal > 0 && (
          <span
            className={
              v.sourcesOk === v.sourcesTotal ? "tag tag-ok" : v.sourcesOk === 0 ? "tag tag-danger" : "tag tag-warn"
            }
            title="Cited URLs that actually load"
          >
            sources {v.sourcesOk}/{v.sourcesTotal}
          </span>
        )}
      </div>
      {c.flags.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-amber-700">
            Review {c.flags.length} flagged claim{c.flags.length === 1 ? "" : "s"} — medical-adjacent niche
          </summary>
          <ul className="mt-1 space-y-1 text-xs">
            {c.flags.map((f, i) => (
              <li key={i} className={f.type === "soften" ? "text-ink-600" : "text-red-700"}>
                <span className="font-medium">[{f.type}]</span> &ldquo;{f.phrase}&rdquo;{" "}
                <span className="text-ink-500">— {f.snippet}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {dead.length > 0 && (
        <div className="text-xs text-red-700">
          {dead.length} dead/blocked link{dead.length === 1 ? "" : "s"}: {dead.map((s) => hostOf(s.url)).join(", ")}
        </div>
      )}
    </div>
  );
}

// ─── Deep Dive (G2) deliverable view ──────────────────────────────────────────
// Renders the angle-synthesis brief up top, then the SOURCES collapsed (title +
// platform only; expand for the URL + its comments), then the flat verbatim bank.
type DdComment = { text?: string; likes?: number; speaker?: string; category?: string };
type DdThread = { url?: string; title?: string; platform?: string; comments?: DdComment[] };
type DdVerbatim = { text?: string; source?: string; category?: string; theme?: string };
type DdSynthesis = {
  whoThisAngleSpeaksTo?: string;
  biggestPain?: string;
  emotionalPain?: string;
  desiredOutcome?: string;
  biggestMisconception?: string;
  existingBeliefs?: string[];
  objections?: string[];
  triggerMoments?: string[];
  hiddenEmotionalTruth?: string;
  freshInsights?: string[];
  competitorBlindSpots?: string[];
  whyOutperformsGeneric?: string;
  positioningVariations?: string[];
  emotionalDirections?: { direction?: string; approach?: string }[];
  messagingTerritories?: string[];
  singleStrongestInsight?: string;
};
type DdAcc = {
  kind?: string;
  avatar?: string;
  threads?: DdThread[];
  verbatims?: DdVerbatim[];
  synthesis?: DdSynthesis;
  bigPatterns?: string[];
  painPoints?: string[];
  desires?: string[];
  fears?: string[];
  objections?: string[];
  dailyLanguage?: string[];
  outliers?: string[];
};

function SField({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{value}</p>
    </div>
  );
}
function SList({ label, value }: { label: string; value?: string[] }) {
  if (!value?.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-sm text-ink-700">
        {value.map((x, i) => (
          <li key={i} className="whitespace-pre-wrap">{x}</li>
        ))}
      </ul>
    </div>
  );
}

function SynthesisView({ s }: { s: DdSynthesis }) {
  return (
    <section className="space-y-3 rounded-md border border-ink-200 bg-ink-50/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">Angle synthesis</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SField label="Who this angle speaks to" value={s.whoThisAngleSpeaksTo} />
        <SField label="Biggest pain" value={s.biggestPain} />
        <SField label="Emotional pain" value={s.emotionalPain} />
        <SField label="Desired outcome" value={s.desiredOutcome} />
        <SField label="Biggest misconception" value={s.biggestMisconception} />
        <SField label="Hidden emotional truth" value={s.hiddenEmotionalTruth} />
      </div>
      <SList label="Existing beliefs" value={s.existingBeliefs} />
      <SList label="Objections" value={s.objections} />
      <SList label="Trigger moments" value={s.triggerMoments} />
      <SList label="Fresh insights" value={s.freshInsights} />
      <SList label="Competitor blind spots" value={s.competitorBlindSpots} />
      <SField label="Why this angle will outperform generic creative" value={s.whyOutperformsGeneric} />
      <SList label="Positioning variations" value={s.positioningVariations} />
      {s.emotionalDirections?.length ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Emotional directions</div>
          <ul className="mt-0.5 space-y-1 text-sm text-ink-700">
            {s.emotionalDirections.map((d, i) => (
              <li key={i}>
                <span className="font-medium capitalize">{d.direction}:</span> {d.approach}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SList label="Messaging territories" value={s.messagingTerritories} />
      {s.singleStrongestInsight?.trim() && (
        <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">
            Single strongest creative insight
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-ink-900">{s.singleStrongestInsight}</p>
        </div>
      )}
    </section>
  );
}

function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const start = page * pageSize;
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-500">
      <button className="btn btn-ghost text-xs" onClick={() => onChange(page - 1)} disabled={page === 0}>
        ← Prev
      </button>
      <span>
        Page {page + 1} of {pageCount} · {start + 1}–{Math.min(start + pageSize, total)} of {total}
      </span>
      <button className="btn btn-ghost text-xs" onClick={() => onChange(page + 1)} disabled={page >= pageCount - 1}>
        Next →
      </button>
    </div>
  );
}

function DeepDiveView({ value }: { value: unknown }) {
  const [page, setPage] = useState(0);
  const [vPage, setVPage] = useState(0);
  const acc = value as DdAcc;
  if (!acc || acc.kind !== "progressive") return <JsonView value={value} />;
  const threads = acc.threads ?? [];
  const verbatims = acc.verbatims ?? [];
  const PAGE_SIZE = 20;

  const tPageCount = Math.max(1, Math.ceil(threads.length / PAGE_SIZE));
  const tCurrent = Math.min(Math.max(0, page), tPageCount - 1);
  const tStart = tCurrent * PAGE_SIZE;
  const pageThreads = threads.slice(tStart, tStart + PAGE_SIZE);

  const vPageCount = Math.max(1, Math.ceil(verbatims.length / PAGE_SIZE));
  const vCurrent = Math.min(Math.max(0, vPage), vPageCount - 1);
  const vStart = vCurrent * PAGE_SIZE;
  const pageVerbatims = verbatims.slice(vStart, vStart + PAGE_SIZE);

  return (
    <div className="space-y-5">
      {acc.avatar && <SField label="Avatar" value={acc.avatar} />}
      {acc.synthesis && <SynthesisView s={acc.synthesis} />}

      {/* Sources — collapsed to title + platform; expand for URL + comments. Paginated 20/page. */}
      <section>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Sources ({threads.length})
        </div>
        {tPageCount > 1 && (
          <div className="mb-2">
            <Pager page={tCurrent} pageCount={tPageCount} total={threads.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}
        <div className="space-y-1">
          {pageThreads.map((t, i) => (
            <details key={t.url || `t-${tStart + i}`} className="rounded-md border border-ink-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-sm">
                <span className="tag shrink-0">{t.platform || "web"}</span>
                <span className="min-w-0 flex-1 truncate text-ink-800">{t.title || t.url || "(untitled)"}</span>
                {t.comments?.length ? (
                  <span className="shrink-0 text-[11px] text-ink-400">{t.comments.length} 💬</span>
                ) : null}
              </summary>
              <div className="border-t border-ink-100 px-2.5 py-2">
                {t.url && (
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-ink-500 underline hover:text-ink-900"
                  >
                    {t.url}
                  </a>
                )}
                {t.comments?.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {t.comments.map((c, j) => (
                      <li key={j} className="whitespace-pre-wrap text-xs text-ink-700">
                        {c.text}
                        {typeof c.likes === "number" && c.likes > 0 && (
                          <span className="ml-1 text-ink-400">({c.likes}👍)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-400">No comments captured for this source.</p>
                )}
              </div>
            </details>
          ))}
        </div>
        {tPageCount > 1 && (
          <div className="mt-2">
            <Pager page={tCurrent} pageCount={tPageCount} total={threads.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}
      </section>

      {/* Verbatims — flat quote bank (kept alongside the per-thread comments). Paginated 20/page. */}
      {verbatims.length > 0 && (
        <section>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Verbatims ({verbatims.length})
          </div>
          {vPageCount > 1 && (
            <div className="mb-2">
              <Pager page={vCurrent} pageCount={vPageCount} total={verbatims.length} pageSize={PAGE_SIZE} onChange={setVPage} />
            </div>
          )}
          <ul className="space-y-1">
            {pageVerbatims.map((v, i) => (
              <li key={vStart + i} className="rounded border border-ink-100 bg-ink-50/50 px-2 py-1 text-xs text-ink-700">
                <span className="whitespace-pre-wrap">&ldquo;{v.text}&rdquo;</span>
                {v.category && <span className="ml-1 text-ink-400">· {v.category}</span>}
              </li>
            ))}
          </ul>
          {vPageCount > 1 && (
            <div className="mt-2">
              <Pager page={vCurrent} pageCount={vPageCount} total={verbatims.length} pageSize={PAGE_SIZE} onChange={setVPage} />
            </div>
          )}
        </section>
      )}

      {/* Raw pattern arrays for reference — collapsed */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Patterns · pains · desires · objections · daily language
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView
            value={{
              bigPatterns: acc.bigPatterns,
              painPoints: acc.painPoints,
              desires: acc.desires,
              fears: acc.fears,
              objections: acc.objections,
              dailyLanguage: acc.dailyLanguage,
              outliers: acc.outliers,
            }}
          />
        </div>
      </details>
    </div>
  );
}

// ─── Root Cause & Mechanism (G3) summary view ─────────────────────────────────
// G3 is a ~20-section document. On screen we surface only the MAIN POINTS (the
// executive summary a strategist scans first); the full document stays one click
// away (collapsed) and is what the ↓ .md download exports in full.
type RcVillain = { type?: string; name?: string; intensity?: number };
type RcStep = { number?: number; name?: string };
type RcHook = { hook?: string; scrollStopScore?: number };
type RootCause = {
  villains?: RcVillain[];
  villainHierarchy?: { primary?: string };
  rootCauseResearch?: {
    hiddenRootCause?: {
      problemStatement?: string;
      mechanismNarrative?: string;
      whyNobodyTalksAboutIt?: string;
    };
  };
  mechanism?: { name?: string; tagline?: string; steps?: RcStep[] };
  primaryFalseBelief?: { belief?: string; correctedBelief?: string; ahaSentence?: string };
  ahaMoment?: { fullAhaSentence?: string };
  marketSophistication?: { stage?: number; stageName?: string; recommendedStrategicResponse?: string };
  plainLanguageSummary?: { oneSentence?: string };
  hooks?: RcHook[];
};

function RootCauseSummary({ value }: { value: unknown }) {
  const rc = (value ?? {}) as RootCause;
  const villains = rc.villains ?? [];
  const steps = rc.mechanism?.steps ?? [];
  const topHooks = [...(rc.hooks ?? [])]
    .filter((h) => h?.hook?.trim())
    .sort((a, b) => (b.scrollStopScore ?? 0) - (a.scrollStopScore ?? 0))
    .slice(0, 3);
  const oneLiner = rc.plainLanguageSummary?.oneSentence?.trim();
  const aha = rc.ahaMoment?.fullAhaSentence?.trim() || rc.primaryFalseBelief?.ahaSentence?.trim();
  const ms = rc.marketSophistication;

  return (
    <div className="space-y-4">
      {/* The single crispest summary line */}
      {oneLiner && (
        <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">In one sentence</div>
          <p className="mt-0.5 text-sm font-medium text-ink-900">{oneLiner}</p>
        </div>
      )}

      {aha && <SField label="The aha" value={aha} />}

      {/* Villains — name + type + intensity; primary flagged. Full copy lives in the download. */}
      {villains.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Villains</div>
          <ul className="mt-1 space-y-1.5">
            {villains.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-800">
                <span className="tag shrink-0 capitalize">{(v.type ?? "villain").replace(/_/g, " ")}</span>
                <span className="min-w-0 flex-1 font-medium">{v.name}</span>
                {typeof v.intensity === "number" && (
                  <span className="shrink-0 text-[11px] text-ink-400">🔥 {v.intensity}/10</span>
                )}
              </li>
            ))}
          </ul>
          {rc.villainHierarchy?.primary?.trim() && (
            <p className="mt-1.5 text-xs text-ink-500">
              <span className="font-semibold text-ink-600">Lead with:</span> {rc.villainHierarchy.primary}
            </p>
          )}
        </div>
      )}

      {/* The root cause — what's physically going wrong (precedes the fix) */}
      {(() => {
        const hrc = rc.rootCauseResearch?.hiddenRootCause;
        if (!hrc?.problemStatement?.trim() && !hrc?.mechanismNarrative?.trim()) return null;
        return (
          <div className="rounded-md border border-ink-200 bg-ink-50/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">The root cause</div>
            {hrc.problemStatement?.trim() && (
              <p className="mt-0.5 text-sm font-semibold text-ink-900">{hrc.problemStatement}</p>
            )}
            {hrc.mechanismNarrative?.trim() && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">{hrc.mechanismNarrative}</p>
            )}
            {hrc.whyNobodyTalksAboutIt?.trim() && (
              <div className="mt-2 border-t border-ink-200/70 pt-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  Why nobody talks about it
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{hrc.whyNobodyTalksAboutIt}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* The mechanism — name, tagline, and just the step names */}
      {(rc.mechanism?.name?.trim() || steps.length > 0) && (
        <div className="rounded-md border border-ink-200 bg-ink-50/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">The mechanism</div>
          {rc.mechanism?.name?.trim() && <p className="mt-0.5 text-sm font-semibold text-ink-900">{rc.mechanism.name}</p>}
          {rc.mechanism?.tagline?.trim() && <p className="mt-0.5 text-sm text-ink-600">{rc.mechanism.tagline}</p>}
          {steps.length > 0 && (
            <ol className="mt-1.5 ml-4 list-decimal space-y-0.5 text-sm text-ink-700">
              {steps.map((s, i) => (
                <li key={i}>{s.name}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* The reframe */}
      {(rc.primaryFalseBelief?.belief?.trim() || rc.primaryFalseBelief?.correctedBelief?.trim()) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SField label="False belief" value={rc.primaryFalseBelief?.belief} />
          <SField label="Corrected belief" value={rc.primaryFalseBelief?.correctedBelief} />
        </div>
      )}

      {/* Strategic takeaway */}
      {ms && (ms.stage != null || ms.recommendedStrategicResponse?.trim()) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Market</span>
          {ms.stage != null && (
            <span className="tag">
              Stage {ms.stage}
              {ms.stageName?.trim() ? ` · ${ms.stageName}` : ""}
            </span>
          )}
          {ms.recommendedStrategicResponse?.trim() && <span>→ {ms.recommendedStrategicResponse}</span>}
        </div>
      )}

      {/* Top hooks by scroll-stop score */}
      {topHooks.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Top hooks</div>
          <ul className="mt-1 space-y-1 text-sm text-ink-700">
            {topHooks.map((h, i) => (
              <li key={i} className="flex items-start gap-2">
                {typeof h.scrollStopScore === "number" && (
                  <span className="shrink-0 text-[11px] text-ink-400">{h.scrollStopScore}/10</span>
                )}
                <span className="min-w-0 flex-1">&ldquo;{h.hook}&rdquo;</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Escape hatch — the complete document, collapsed. The ↓ .md download exports this in full. */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document — every section (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Avatar Intelligence Report (AIR) summary view ────────────────────────────
// Researcher-first reading of the report. Deliberate trims vs the raw doc: segment
// cards drop `name`/`buyingAwareness` (both stay in the ↓ .md download), triggers
// ride in a side rail next to the highlighted problems, outcomes are boxed, and
// hidden insights get their own standout section.
type AirSegment = { name?: string; description?: string; buyingAwareness?: string; biggestFrustration?: string; biggestDesire?: string };
type AirProblem = { rank?: number; problem?: string; whyItMatters?: string };
type AirEmotion = { emotion?: string; howItShowsUp?: string };
type AirOpportunity = { opportunity?: string; score?: number; why?: string };
type AirAngle = { name?: string; avatar?: string; emotion?: string; awarenessLevel?: string; expectedCtr?: number; originality?: number; metaPerformanceScore?: number };
type AirPick = { angleName?: string; why?: string };
type AvatarIntel = {
  avatarSummary?: string;
  segments?: AirSegment[];
  coreProblems?: AirProblem[];
  emotionalProblems?: AirEmotion[];
  triggerMoments?: string[];
  existingBeliefs?: string[];
  objections?: string[];
  desiredOutcomes?: { functional?: string[]; emotional?: string[]; identity?: string[]; lifestyle?: string[] };
  hiddenInsights?: string[];
  opportunities?: AirOpportunity[];
  angles?: AirAngle[];
  budget500kTestPlan?: AirPick[];
};

function AirLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{children}</div>;
}

function AvatarIntelSummary({ value }: { value: unknown }) {
  const air = (value ?? {}) as AvatarIntel;
  const segments = (air.segments ?? []).filter((s) => s?.description?.trim() || s?.name?.trim());
  const coreProblems = (air.coreProblems ?? []).filter((p) => p?.problem?.trim());
  const emotional = (air.emotionalProblems ?? []).filter((e) => e?.emotion?.trim());
  const triggers = (air.triggerMoments ?? []).filter((t) => t?.trim());
  const insights = (air.hiddenInsights ?? []).filter((t) => t?.trim());
  const outcomes: [string, string[]][] = [
    ["Functional", air.desiredOutcomes?.functional ?? []],
    ["Emotional", air.desiredOutcomes?.emotional ?? []],
    ["Identity", air.desiredOutcomes?.identity ?? []],
    ["Lifestyle", air.desiredOutcomes?.lifestyle ?? []],
  ];
  const hasOutcomes = outcomes.some(([, items]) => items.length > 0);
  const opportunities = [...(air.opportunities ?? [])]
    .filter((o) => o?.opportunity?.trim())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const angles = [...(air.angles ?? [])]
    .filter((a) => a?.name?.trim())
    .sort((a, b) => (b.metaPerformanceScore ?? 0) - (a.metaPerformanceScore ?? 0));
  const picks = (air.budget500kTestPlan ?? []).filter((p) => p?.angleName?.trim());

  return (
    <div className="space-y-5">
      {/* Who she is */}
      {air.avatarSummary?.trim() && (
        <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">The avatar</div>
          <p className="mt-0.5 text-sm font-medium text-ink-900">{air.avatarSummary}</p>
        </div>
      )}

      {/* Segments — description-led cards (name + buying awareness live in the .md) */}
      {segments.length > 0 && (
        <div>
          <AirLabel>Avatar segments ({segments.length})</AirLabel>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {segments.map((s, i) => (
              <div key={i} className="rounded-md border border-ink-200 bg-white p-2.5">
                <p className="text-sm font-medium text-ink-900">{s.description || s.name}</p>
                {s.biggestFrustration?.trim() && (
                  <p className="mt-1 text-xs text-ink-600">
                    <span className="font-semibold text-red-700">Frustration · </span>
                    {s.biggestFrustration}
                  </p>
                )}
                {s.biggestDesire?.trim() && (
                  <p className="mt-0.5 text-xs text-ink-600">
                    <span className="font-semibold text-emerald-700">Desire · </span>
                    {s.biggestDesire}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Problems (highlighted) with trigger moments in a side rail */}
      {(coreProblems.length > 0 || emotional.length > 0 || triggers.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-3 sm:col-span-2">
            {coreProblems.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Core problems — ranked
                </div>
                <ol className="mt-1.5 space-y-1.5">
                  {coreProblems.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-semibold text-ink-900">
                        {p.rank ?? i + 1}. {p.problem}
                      </span>
                      {p.whyItMatters?.trim() && <span className="text-ink-600"> — {p.whyItMatters}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {emotional.length > 0 && (
              <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">
                  Emotional problems — beneath the surface
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {emotional.map((e, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-semibold text-ink-900">{e.emotion}</span>
                      {e.howItShowsUp?.trim() && <span className="text-ink-600"> — {e.howItShowsUp}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {triggers.length > 0 && (
            <aside className="self-start rounded-md border border-ink-200 bg-ink-50/40 p-3">
              <AirLabel>Trigger moments</AirLabel>
              <ul className="mt-1.5 space-y-1 text-sm text-ink-700">
                {triggers.map((t, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0 text-brand-plum">⚡</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}

      {/* Desired outcomes — one box per dimension */}
      {hasOutcomes && (
        <div>
          <AirLabel>Desired outcomes</AirLabel>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {outcomes.map(([label, items]) =>
              items.length > 0 ? (
                <div key={label} className="rounded-md border border-ink-200 bg-white p-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5 text-sm text-ink-700">
                    {items.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Hidden insights — its own standout section */}
      {insights.length > 0 && (
        <div className="rounded-md border-2 border-ink-900 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-900">
            Hidden insights — what she doesn&apos;t say out loud
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {insights.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-800">
                <span className="shrink-0">💡</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Beliefs + objections — compact, side by side */}
      {(air.existingBeliefs?.length || air.objections?.length) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SList label="Existing beliefs" value={air.existingBeliefs} />
          <SList label="Objections" value={air.objections} />
        </div>
      ) : null}

      {/* Opportunities — score-ranked */}
      {opportunities.length > 0 && (
        <div>
          <AirLabel>Opportunities — ranked</AirLabel>
          <ul className="mt-1.5 space-y-1.5">
            {opportunities.map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="tag shrink-0">{o.score ?? "–"}/10</span>
                <span>
                  <span className="font-medium text-ink-900">{o.opportunity}</span>
                  {o.why?.trim() && <span className="text-ink-600"> — {o.why}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The 20 angles — compact scoreboard (full details in the .md) */}
      {angles.length > 0 && (
        <div>
          <AirLabel>Advertising angles ({angles.length}) — by Meta score</AirLabel>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-500">
                  <th className="py-1 pr-3 font-semibold">Angle</th>
                  <th className="py-1 pr-3 font-semibold">Emotion</th>
                  <th className="py-1 pr-3 font-semibold">Awareness</th>
                  <th className="py-1 pr-2 text-right font-semibold" title="Expected CTR">CTR</th>
                  <th className="py-1 pr-2 text-right font-semibold" title="Originality">Orig</th>
                  <th className="py-1 text-right font-semibold" title="Meta performance score">Meta</th>
                </tr>
              </thead>
              <tbody>
                {angles.map((a, i) => (
                  <tr key={i} className="border-b border-ink-100 last:border-0 align-top">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium text-ink-900">{a.name}</div>
                      {a.avatar?.trim() && <div className="text-xs text-ink-500">{a.avatar}</div>}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-600">{a.emotion || "—"}</td>
                    <td className="py-1.5 pr-3 text-xs text-ink-500">{a.awarenessLevel || "—"}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-700">{a.expectedCtr ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-700">{a.originality ?? "—"}</td>
                    <td className="py-1.5 text-right font-semibold text-ink-900">{a.metaPerformanceScore ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The $500k question */}
      {picks.length > 0 && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            $500K on Meta tomorrow — test these 5 first
          </div>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1.5">
            {picks.map((p, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold text-ink-900">{p.angleName}</span>
                {p.why?.trim() && <span className="text-ink-600"> — {p.why}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Escape hatch — everything, incl. segment names + buying awareness */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full report — every field (segment names, buying awareness, angle rationale; or use ↓ .md)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Brand DNA summary view ───────────────────────────────────────────────────
// How CelluMove shows up in THIS funnel. Copywriter-first layout: positioning +
// USP lead, pillars as numbered cards, voice beside values, and the Do-Say /
// Don't-Say guardrails as green/red checklists (the section writers use most).
type BrandDna = {
  positioning?: string;
  usp?: string;
  pillars?: string[];
  voiceAndTone?: string;
  coreValues?: string[];
  originStory?: string;
  doSay?: string[];
  dontSay?: string[];
};

function BrandDnaSummary({ value }: { value: unknown }) {
  const dna = (value ?? {}) as BrandDna;
  const pillars = (dna.pillars ?? []).filter((p) => p?.trim());
  const values = (dna.coreValues ?? []).filter((v) => v?.trim());
  const doSay = (dna.doSay ?? []).filter((s) => s?.trim());
  const dontSay = (dna.dontSay ?? []).filter((s) => s?.trim());

  return (
    <div className="space-y-5">
      {/* Positioning — the lead */}
      {dna.positioning?.trim() && (
        <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">Positioning</div>
          <p className="mt-0.5 text-sm font-medium text-ink-900">{dna.positioning}</p>
        </div>
      )}

      {/* USP — the one thing only we can say */}
      {dna.usp?.trim() && (
        <div className="rounded-md border-2 border-ink-900 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-900">Unique selling proposition</div>
          <p className="mt-0.5 text-sm font-medium text-ink-900">{dna.usp}</p>
        </div>
      )}

      {/* Pillars — numbered cards */}
      {pillars.length > 0 && (
        <div>
          <AirLabel>Brand pillars</AirLabel>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {pillars.map((p, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-ink-200 bg-white p-2.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <p className="text-sm text-ink-800">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice & tone beside core values */}
      {(dna.voiceAndTone?.trim() || values.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {dna.voiceAndTone?.trim() && (
            <div className="rounded-md border border-ink-200 bg-ink-50/40 p-3 sm:col-span-2">
              <AirLabel>Voice &amp; tone — how we speak to her</AirLabel>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{dna.voiceAndTone}</p>
            </div>
          )}
          {values.length > 0 && (
            <aside className="self-start rounded-md border border-ink-200 bg-white p-3">
              <AirLabel>Core values</AirLabel>
              <ul className="mt-1.5 space-y-2.5">
                {values.map((v, i) => {
                  // Values usually come as "Name: description" — split so the name
                  // reads as a heading instead of squeezing the sentence into a chip.
                  const m = v.match(/^([^:]{2,40}):\s*(\S[\s\S]*)$/);
                  return (
                    <li key={i} className="text-sm">
                      {m ? (
                        <>
                          <div className="font-semibold text-ink-900">{m[1]}</div>
                          <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{m[2]}</p>
                        </>
                      ) : (
                        <p className="text-ink-800">{v}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}
        </div>
      )}

      {/* Do say / Don't say — the copywriter guardrails */}
      {(doSay.length > 0 || dontSay.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {doSay.length > 0 && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Do say</div>
              <ul className="mt-1.5 space-y-1">
                {doSay.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-ink-800">
                    <span className="shrink-0 text-emerald-600">✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dontSay.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Don&apos;t say</div>
              <ul className="mt-1.5 space-y-1">
                {dontSay.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-ink-800">
                    <span className="shrink-0 text-red-600">✕</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Origin story — narrative, last */}
      {dna.originStory?.trim() && (
        <div>
          <AirLabel>Origin story — why we exist</AirLabel>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{dna.originStory}</p>
        </div>
      )}

      {/* Escape hatch — the raw document */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Copy Arsenal (G4) summary view ───────────────────────────────────────────
// A copy BANK, not a document — writers grab lines from it mid-writing. So every
// line is one click to copy, sections are grouped by asset type, and the big
// ideas (which everything else hangs off) lead as numbered highlights.
type CopyCrusher = { objection?: string; rebuttal?: string };
type CopyArsenal = {
  bigIdeas?: string[];
  headlines?: string[];
  leads?: string[];
  fascinationBullets?: string[];
  hooks?: string[];
  ctas?: string[];
  objectionCrushers?: CopyCrusher[];
  powerPhrases?: string[];
};

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy to clipboard"
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] transition ${
        copied ? "text-emerald-600" : "text-ink-400 hover:bg-ink-100 hover:text-ink-900"
      }`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "✓ copied" : `⧉ ${label}`}
    </button>
  );
}

// One labelled bank of copy-ready lines, each with a copy button.
function CopyBank({ label, items, columns = 1 }: { label: string; items: string[]; columns?: 1 | 2 }) {
  const list = items.filter((t) => t?.trim());
  if (!list.length) return null;
  return (
    <div>
      <AirLabel>
        {label} ({list.length})
      </AirLabel>
      <ul className={columns === 2 ? "mt-1.5 grid gap-1.5 sm:grid-cols-2" : "mt-1.5 space-y-1.5"}>
        {list.map((t, i) => (
          <li
            key={i}
            className="flex items-start justify-between gap-2 rounded-md border border-ink-100 bg-ink-50/50 px-2.5 py-1.5"
          >
            <span className="whitespace-pre-wrap text-sm text-ink-800">{t}</span>
            <CopyButton text={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Short her-voice phrase as a click-to-copy chip (wrap-safe, never a squeezed pill).
function PhraseChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`rounded-md border px-2 py-1 text-left text-xs transition ${
        copied
          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
          : "border-ink-200 bg-ink-50 text-ink-700 hover:border-ink-900"
      }`}
    >
      {copied ? "✓ " : ""}
      &ldquo;{text}&rdquo;
    </button>
  );
}

function CopyArsenalSummary({ value }: { value: unknown }) {
  const ca = (value ?? {}) as CopyArsenal;
  const bigIdeas = (ca.bigIdeas ?? []).filter((t) => t?.trim());
  const crushers = (ca.objectionCrushers ?? []).filter((c) => c?.objection?.trim() || c?.rebuttal?.trim());
  const phrases = (ca.powerPhrases ?? []).filter((t) => t?.trim());

  return (
    <div className="space-y-5">
      {/* Big ideas — the strategic spine everything else hangs off */}
      {bigIdeas.length > 0 && (
        <div>
          <AirLabel>Big ideas ({bigIdeas.length})</AirLabel>
          <div className="mt-1.5 space-y-2">
            {bigIdeas.map((t, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-brand-pink/40 bg-brand-pink/5 p-2.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-plum text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <p className="flex-1 text-sm font-medium text-ink-900">{t}</p>
                <CopyButton text={t} />
              </div>
            ))}
          </div>
        </div>
      )}

      <CopyBank label="Hooks" items={ca.hooks ?? []} />
      <CopyBank label="Headlines" items={ca.headlines ?? []} />
      <CopyBank label="Leads / openers" items={ca.leads ?? []} />
      <CopyBank label="Fascination bullets" items={ca.fascinationBullets ?? []} />

      {/* Objection crushers — objection → rebuttal pairs */}
      {crushers.length > 0 && (
        <div>
          <AirLabel>Objection crushers ({crushers.length})</AirLabel>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {crushers.map((c, i) => (
              <div key={i} className="rounded-md border border-ink-200 bg-white p-2.5">
                {c.objection?.trim() && <p className="text-xs font-medium text-red-700">✕ {c.objection}</p>}
                {c.rebuttal?.trim() && (
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm text-ink-800">{c.rebuttal}</p>
                    <CopyButton text={c.rebuttal} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <CopyBank label="CTAs" items={ca.ctas ?? []} columns={2} />

      {/* Power phrases — her actual words, click to copy */}
      {phrases.length > 0 && (
        <div>
          <AirLabel>Power phrases — her words (click to copy)</AirLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {phrases.map((p, i) => (
              <PhraseChip key={i} text={p} />
            ))}
          </div>
        </div>
      )}

      {/* Escape hatch — the raw document */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Advertorial (G5) view ────────────────────────────────────────────────────
// It's an ARTICLE, so render it like one — headline, dek, byline, flowing
// sections, CTA callout, P.S. — with a one-click "copy article" for pasting the
// whole piece into a doc or landing-page builder.
type AdvertorialSection = { heading?: string; body?: string };
type Advertorial = {
  headline?: string;
  subheadline?: string;
  byline?: string;
  sections?: AdvertorialSection[];
  callToAction?: string;
  ps?: string;
};

function advertorialAsText(a: Advertorial): string {
  const parts: string[] = [];
  if (a.headline?.trim()) parts.push(a.headline.trim());
  if (a.subheadline?.trim()) parts.push(a.subheadline.trim());
  if (a.byline?.trim()) parts.push(`By ${a.byline.trim()}`);
  for (const s of a.sections ?? []) {
    if (s?.heading?.trim()) parts.push(`\n${s.heading.trim()}`);
    if (s?.body?.trim()) parts.push(s.body.trim());
  }
  if (a.callToAction?.trim()) parts.push(`\n${a.callToAction.trim()}`);
  if (a.ps?.trim()) parts.push(`P.S. ${a.ps.trim()}`);
  return parts.join("\n\n");
}

function AdvertorialView({ value }: { value: unknown }) {
  const a = (value ?? {}) as Advertorial;
  const sections = (a.sections ?? []).filter((s) => s?.heading?.trim() || s?.body?.trim());
  const words = advertorialAsText(a).split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <article className="rounded-md border border-ink-200 bg-white p-4 sm:p-6">
        {/* Masthead */}
        {a.headline?.trim() && (
          <h1 className="text-xl font-bold leading-snug tracking-tight text-ink-900">{a.headline}</h1>
        )}
        {a.subheadline?.trim() && <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{a.subheadline}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3">
          <span className="text-xs italic text-ink-400">
            {a.byline?.trim() ? `By ${a.byline}` : "Advertorial"} · {sections.length} section
            {sections.length === 1 ? "" : "s"} · ~{words.toLocaleString()} words
          </span>
          <CopyButton text={advertorialAsText(a)} />
        </div>

        {/* Body */}
        {sections.map((s, i) => (
          <section key={i} className="mt-4">
            {s.heading?.trim() && <h2 className="text-sm font-semibold text-ink-900">{s.heading}</h2>}
            {s.body?.trim() && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{s.body}</p>
            )}
          </section>
        ))}

        {/* CTA */}
        {a.callToAction?.trim() && (
          <div className="mt-5 flex items-start justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 p-3">
            <p className="flex-1 text-sm font-medium text-ink-900">{a.callToAction}</p>
            <CopyButton text={a.callToAction} />
          </div>
        )}

        {/* P.S. */}
        {a.ps?.trim() && (
          <p className="mt-4 whitespace-pre-wrap text-sm italic leading-relaxed text-ink-600">
            <span className="font-semibold not-italic text-ink-900">P.S. </span>
            {a.ps}
          </p>
        )}
      </article>

      {/* Escape hatch — the raw document */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Ad Scripts & Copy (G6) view ──────────────────────────────────────────────
// Ready-to-shoot scripts: each one a collapsible card with its hook highlighted,
// the storyboard as a real beat TABLE (time/visual/on-screen/VO), a CTA callout,
// and a one-click "copy script" formatted for handing to an editor/creator.
type ScriptBeat = { time?: string; visual?: string; onScreenText?: string; voiceover?: string };
type AdScript = { title?: string; hookMechanic?: string; hook?: string; beats?: ScriptBeat[]; cta?: string };
type AdScriptsDoc = { scripts?: AdScript[]; primaryTexts?: string[]; adHeadlines?: string[] };

function scriptAsText(s: AdScript): string {
  const parts: string[] = [];
  if (s.title?.trim()) parts.push(`${s.title.trim()}${s.hookMechanic?.trim() ? ` (${s.hookMechanic.trim()})` : ""}`);
  if (s.hook?.trim()) parts.push(`HOOK: ${s.hook.trim()}`);
  for (const b of s.beats ?? []) {
    const bits = [
      b.time?.trim() ? `[${b.time.trim()}]` : "",
      b.visual?.trim() ? `VISUAL: ${b.visual.trim()}` : "",
      b.onScreenText?.trim() ? `TEXT: ${b.onScreenText.trim()}` : "",
      b.voiceover?.trim() ? `VO: ${b.voiceover.trim()}` : "",
    ].filter(Boolean);
    if (bits.length) parts.push(bits.join(" · "));
  }
  if (s.cta?.trim()) parts.push(`CTA: ${s.cta.trim()}`);
  return parts.join("\n");
}

// The specific winning ads a generated script/brief most resembles — the evidence
// behind its ROAS chip. Shows each neighbor's creative, name, market and real ROAS,
// linking out to the original post. Shared by the G6 scripts and G7 briefs views.
function SimilarWinners({ est }: { est: RoasEstimate }) {
  if (!est.neighbors.length) return null;
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50/40 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Most similar winning ads
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {est.neighbors.map((n, i) => {
          const inner = (
            <>
              {n.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={n.imagePath}
                  alt={n.adName}
                  className="h-11 w-11 shrink-0 rounded border border-ink-200 object-cover"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded border border-dashed border-ink-300 bg-white" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-ink-200/70 px-1 text-[10px] font-medium text-ink-700">{n.market}</span>
                  <span className="text-xs font-semibold tabular-nums text-emerald-700">{n.roas.toFixed(2)}×</span>
                </div>
                <div className="mt-0.5 truncate text-xs font-medium text-ink-800" title={n.adName}>
                  {n.adName}
                </div>
                {n.headline?.trim() && (
                  <div className="mt-0.5 line-clamp-1 text-[11px] text-ink-400">&ldquo;{n.headline}&rdquo;</div>
                )}
              </div>
            </>
          );
          const cls = "flex items-start gap-2 rounded-md border border-ink-200 bg-white p-1.5";
          return n.postLink ? (
            <a
              key={i}
              href={n.postLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`${cls} transition hover:border-ink-400 hover:shadow-card-hover`}
              title="Open the original ad post"
            >
              {inner}
            </a>
          ) : (
            <div key={i} className={cls}>
              {inner}
            </div>
          );
        })}
      </div>
      {est.confidence === "low" && (
        <p className="mt-1.5 text-[11px] text-amber-700">Low similarity · novel territory, treat the match loosely.</p>
      )}
    </div>
  );
}

function AdScriptsView({ value }: { value: unknown }) {
  const doc = (value ?? {}) as AdScriptsDoc;
  const scripts = (doc.scripts ?? []).filter((s) => s?.title?.trim() || s?.hook?.trim() || s?.beats?.length);

  // Similar-winners ROAS estimates — computed once per open from the analyzed
  // winner bank. Directional (backtested weak within winners-only data), so the
  // chip always ships with its evidence, never as a bare number.
  const [ests, setEsts] = useState<(RoasEstimate | null)[] | "loading">("loading");
  useEffect(() => {
    let alive = true;
    if (!scripts.length) {
      setEsts([]);
      return;
    }
    setEsts("loading");
    predictScriptsRoas(scripts.map((s) => scriptAsText(s)))
      .then((r) => {
        if (alive) setEsts(r);
      })
      .catch(() => {
        if (alive) setEsts(scripts.map(() => null));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-5">
      {scripts.length > 0 && (
        <div>
          <AirLabel>Scripts ({scripts.length}) — each with a distinct hook mechanic</AirLabel>
          <div className="mt-1.5 space-y-3">
            {scripts.map((s, i) => {
              const beats = (s.beats ?? []).filter(
                (b) => b?.time?.trim() || b?.visual?.trim() || b?.onScreenText?.trim() || b?.voiceover?.trim(),
              );
              const est = ests !== "loading" ? ests[i] : undefined;
              return (
                <details key={i} open className="rounded-md border border-ink-200 bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
                    <span className="text-sm font-semibold text-ink-900">{s.title || `Script ${i + 1}`}</span>
                    {s.hookMechanic?.trim() && <span className="tag">{s.hookMechanic}</span>}
                    {ests === "loading" ? (
                      <span className="text-[11px] text-ink-400">est. ROAS…</span>
                    ) : est ? (
                      <span
                        className={`tag ${est.confidence === "high" ? "tag-ok" : est.confidence === "low" ? "tag-warn" : ""}`}
                        title={`Similar-winners estimate: spend-weighted median ROAS of the 10 most similar analyzed winning ads (band ${est.p25.toFixed(2)}–${est.p75.toFixed(2)}×, ${est.confidence} confidence). Directional — not a validated forecast.`}
                      >
                        ~{est.roas.toFixed(2)}× est.
                      </span>
                    ) : null}
                    <span className="ml-auto text-[11px] text-ink-400">
                      {beats.length} beat{beats.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <div className="space-y-2.5 border-t border-ink-100 p-3">
                    {s.hook?.trim() && (
                      <div className="flex items-start justify-between gap-2 rounded-md border border-brand-pink/40 bg-brand-pink/5 p-2.5">
                        <p className="flex-1 text-sm font-medium text-ink-900">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">Hook · </span>
                          {s.hook}
                        </p>
                        <CopyButton text={s.hook} />
                      </div>
                    )}
                    {est && <SimilarWinners est={est} />}

                    {beats.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead>
                            <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-500">
                              <th className="w-16 py-1 pr-3 font-semibold">Time</th>
                              <th className="py-1 pr-3 font-semibold">Visual</th>
                              <th className="py-1 pr-3 font-semibold">On-screen text</th>
                              <th className="py-1 font-semibold">Voiceover</th>
                            </tr>
                          </thead>
                          <tbody>
                            {beats.map((b, j) => (
                              <tr key={j} className="border-b border-ink-100 align-top last:border-0">
                                <td className="whitespace-nowrap py-1.5 pr-3 text-xs font-medium text-ink-500">
                                  {b.time || "—"}
                                </td>
                                <td className="py-1.5 pr-3 text-ink-700">{b.visual || "—"}</td>
                                <td className="py-1.5 pr-3 font-medium text-ink-900">{b.onScreenText || "—"}</td>
                                <td className="py-1.5 text-ink-700">{b.voiceover || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {s.cta?.trim() ? (
                        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 p-2.5">
                          <p className="flex-1 text-sm font-medium text-ink-900">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">CTA · </span>
                            {s.cta}
                          </p>
                          <CopyButton text={s.cta} />
                        </div>
                      ) : (
                        <span />
                      )}
                      <CopyButton text={scriptAsText(s)} label="copy script" />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      <CopyBank label="Meta primary texts" items={doc.primaryTexts ?? []} />
      <CopyBank label="Ad headlines" items={doc.adHeadlines ?? []} columns={2} />

      {/* Escape hatch — the raw document */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Creative Briefs (G7) view ────────────────────────────────────────────────
// Design/shoot-ready briefs an editor executes WITHOUT the strategist. Each brief
// is a collapsible card: key visual highlighted, exact copy grabbable, the shot
// list as a checklist, deliverables as chips, and "copy brief" for handoff.
type CreativeBrief = {
  title?: string;
  format?: string; // "static" | "video"
  concept?: string;
  keyVisual?: string;
  copyToUse?: string;
  shotList?: string[];
  productionNotes?: string;
  deliverables?: string[];
};
type CreativeBriefsDoc = { briefs?: CreativeBrief[] };

function briefAsText(b: CreativeBrief): string {
  const parts: string[] = [];
  if (b.title?.trim()) parts.push(`${b.title.trim()}${b.format?.trim() ? ` [${b.format.trim()}]` : ""}`);
  if (b.concept?.trim()) parts.push(`CONCEPT: ${b.concept.trim()}`);
  if (b.keyVisual?.trim()) parts.push(`KEY VISUAL: ${b.keyVisual.trim()}`);
  if (b.copyToUse?.trim()) parts.push(`COPY: ${b.copyToUse.trim()}`);
  const shots = (b.shotList ?? []).filter((s) => s?.trim());
  if (shots.length) parts.push(`SHOT LIST:\n${shots.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n")}`);
  if (b.productionNotes?.trim()) parts.push(`PRODUCTION NOTES: ${b.productionNotes.trim()}`);
  const dels = (b.deliverables ?? []).filter((d) => d?.trim());
  if (dels.length) parts.push(`DELIVERABLES:\n${dels.map((d) => `- ${d.trim()}`).join("\n")}`);
  return parts.join("\n\n");
}

function CreativeBriefsView({ value }: { value: unknown }) {
  const doc = (value ?? {}) as CreativeBriefsDoc;
  const briefs = (doc.briefs ?? []).filter((b) => b?.title?.trim() || b?.concept?.trim() || b?.keyVisual?.trim());

  // Similar-winners ROAS estimates — same directional method as the G6 scripts
  // view (spend-weighted median of the nearest analyzed winners). Ships with its
  // neighbor evidence, never as a bare number.
  const [ests, setEsts] = useState<(RoasEstimate | null)[] | "loading">("loading");
  useEffect(() => {
    let alive = true;
    if (!briefs.length) {
      setEsts([]);
      return;
    }
    setEsts("loading");
    predictScriptsRoas(briefs.map((b) => briefAsText(b)))
      .then((r) => {
        if (alive) setEsts(r);
      })
      .catch(() => {
        if (alive) setEsts(briefs.map(() => null));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-5">
      {briefs.length > 0 && (
        <div>
          <AirLabel>Creative briefs ({briefs.length}) — one per creative</AirLabel>
          <div className="mt-1.5 space-y-3">
            {briefs.map((b, i) => {
              const shots = (b.shotList ?? []).filter((s) => s?.trim());
              const dels = (b.deliverables ?? []).filter((d) => d?.trim());
              const isVideo = (b.format ?? "").toLowerCase() === "video";
              const est = ests !== "loading" ? ests[i] : undefined;
              return (
                <details key={i} open className="rounded-md border border-ink-200 bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
                    <span className="text-sm font-semibold text-ink-900">{b.title || `Brief ${i + 1}`}</span>
                    {b.format?.trim() && (
                      <span className={`tag ${isVideo ? "tag-warn" : "tag-ok"}`}>{b.format}</span>
                    )}
                    {ests === "loading" ? (
                      <span className="text-[11px] text-ink-400">est. ROAS…</span>
                    ) : est ? (
                      <span
                        className={`tag ${est.confidence === "high" ? "tag-ok" : est.confidence === "low" ? "tag-warn" : ""}`}
                        title={`Similar-winners estimate: spend-weighted median ROAS of the 10 most similar analyzed winning ads (band ${est.p25.toFixed(2)}–${est.p75.toFixed(2)}×, ${est.confidence} confidence). Directional — not a validated forecast.`}
                      >
                        ~{est.roas.toFixed(2)}× est.
                      </span>
                    ) : null}
                    {shots.length > 0 && (
                      <span className="ml-auto text-[11px] text-ink-400">
                        {shots.length} shot{shots.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </summary>
                  <div className="space-y-2.5 border-t border-ink-100 p-3">
                    {est && <SimilarWinners est={est} />}
                    {b.concept?.trim() && (
                      <div>
                        <AirLabel>Concept</AirLabel>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{b.concept}</p>
                      </div>
                    )}

                    {b.keyVisual?.trim() && (
                      <div className="rounded-md border border-brand-pink/40 bg-brand-pink/5 p-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-plum">Key visual</div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-ink-900">{b.keyVisual}</p>
                      </div>
                    )}

                    {b.copyToUse?.trim() && (
                      <div className="flex items-start justify-between gap-2 rounded-md border border-ink-200 bg-ink-50/50 p-2.5">
                        <p className="flex-1 whitespace-pre-wrap text-sm text-ink-800">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Copy · </span>
                          {b.copyToUse}
                        </p>
                        <CopyButton text={b.copyToUse} />
                      </div>
                    )}

                    {shots.length > 0 && (
                      <div>
                        <AirLabel>Shot list</AirLabel>
                        <ol className="mt-1 space-y-1">
                          {shots.map((s, j) => (
                            <li key={j} className="flex gap-2 text-sm text-ink-700">
                              <span className="shrink-0 font-medium text-ink-400">{j + 1}.</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {b.productionNotes?.trim() && (
                      <div>
                        <AirLabel>Production notes</AirLabel>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-600">{b.productionNotes}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {dels.length > 0 ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                            Deliverables
                          </span>
                          {dels.map((d, j) => (
                            <span key={j} className="rounded-md border border-ink-200 bg-ink-50 px-2 py-0.5 text-xs text-ink-700">
                              {d}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span />
                      )}
                      <CopyButton text={briefAsText(b)} label="copy brief" />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* Escape hatch — the raw document */}
      <details className="rounded-md border border-ink-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-semibold text-ink-600">
          Full document (or use ↓ .md for the complete export)
        </summary>
        <div className="border-t border-ink-100 p-2.5">
          <JsonView value={value} />
        </div>
      </details>
    </div>
  );
}

// ─── Generic, schema-tolerant JSON renderer ───────────────────────────────────
// The stage output schemas will change during review, so render whatever shape
// comes back rather than hard-coding fields.
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === "") return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="whitespace-pre-wrap text-sm text-ink-700">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    const allPrimitive = value.every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    if (allPrimitive) {
      return (
        <ul className="ml-4 list-disc space-y-0.5 text-sm text-ink-700">
          {value.map((v, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {String(v)}
            </li>
          ))}
        </ul>
      );
    }
    // Cap huge arrays (e.g. a 1000-quote deep dive) so opening the modal doesn't
    // build tens of thousands of DOM nodes at once — the full set is in the .md.
    const CAP = 100;
    const shown = value.slice(0, CAP);
    return (
      <div className="space-y-2">
        {shown.map((v, i) => (
          <div key={i} className="rounded-md border border-ink-200 bg-ink-50/50 p-2.5">
            <JsonView value={v} depth={depth + 1} />
          </div>
        ))}
        {value.length > CAP && (
          <div className="text-xs text-ink-500">
            +{value.length - CAP} more — download the .md for the full list.
          </div>
        )}
      </div>
    );
  }

  // object
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v != null && v !== "",
  );
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            {humanize(k)}
          </div>
          <div className="mt-0.5">
            <JsonView value={v} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}
