"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MinerTabs } from "../MinerTabs";
import { BrandPicker, BrandRail } from "./components/BrandRail";
import { Outcomes } from "./components/Outcomes";
import { RunCostDialog } from "./components/RunCostDialog";
import { RunHero } from "./components/RunHero";
import { StageStepper } from "./components/StageStepper";
import { TeardownCard } from "./components/TeardownCard";
import { ArrowIcon, ClockIcon } from "./components/icons";
import { STAGES, stageDef } from "./stages";
import type { PipelineOptions, RunSnapshot, StageKey, StageOptions } from "./types";
import { useRunEngine } from "./useRunEngine";
import { useRunMarker } from "./useRunMarker";

const LAST_BRAND_KEY = "adfactory.miner.brand";

const defaultOptions = (): Record<StageKey, StageOptions> => Object.fromEntries(
  STAGES.map((stage) => [stage.key, { limit: stage.defaultLimit ?? null, force: false, retryReview: false, skipGate: false, target: 100 }]),
) as Record<StageKey, StageOptions>;

export function RunClient({ snapshot, canRun }: { snapshot: RunSnapshot; canRun: boolean }) {
  const router = useRouter();
  const brand = snapshot.brand;
  const [now, setNow] = useState(() => Date.now());
  const [tabHidden, setTabHidden] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState(defaultOptions);

  const refresh = useCallback(() => router.refresh(), [router]);
  const engine = useRunEngine(refresh);
  const { marker, save, clear } = useRunMarker(brand?.domain ?? null);
  const active = engine.run?.phase === "running";

  // Remember the brand so a return visit lands where you left off.
  useEffect(() => {
    if (!brand) return;
    try { window.localStorage.setItem(LAST_BRAND_KEY, brand.domain); } catch { /* storage blocked */ }
  }, [brand]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [active]);

  // ETA is nonsense while the tab is hidden: timers throttle, fetches do not.
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  // Keep the resume breadcrumb in step with the run.
  useEffect(() => {
    const run = engine.run;
    if (!run) return;
    if (run.phase === "running" && run.current) {
      save({ brand: run.brand, stage: run.current, startedAt: run.startedAt, target: snapshot.defaultTarget, skipGate: !snapshot.gate.passed });
    } else if (run.phase === "finished") {
      clear();
    }
  }, [clear, engine.run, save, snapshot.defaultTarget, snapshot.gate.passed]);

  // Teardowns submitted earlier are still running: pick them back up.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !canRun || !brand || !snapshot.pendingTeardowns.length) return;
    resumed.current = true;
    void engine.watchPendingTeardowns(brand.domain, snapshot.pendingTeardowns);
  }, [brand, canRun, engine, snapshot.pendingTeardowns]);

  const startPipeline = useCallback((pipelineOptions: PipelineOptions) => {
    setConfirming(false);
    void engine.runPipeline(pipelineOptions);
  }, [engine]);

  const resumeRun = useCallback(() => {
    if (!brand) return;
    clear();
    void engine.runPipeline({ brand: brand.domain, target: snapshot.defaultTarget, includeCollect: false, skipGate: !snapshot.gate.passed });
  }, [brand, clear, engine, snapshot.defaultTarget, snapshot.gate.passed]);

  if (!brand) {
    return (
      <div className="space-y-8">
        <Header />
        <BrandPicker brands={snapshot.brands} unavailable={snapshot.competitorsUnavailable} />
      </div>
    );
  }

  const interrupted = marker && !engine.run && marker.brand === brand.domain && brand.extracted < brand.inCorpus;

  return (
    <div className="space-y-6">
      <Header />
      <BrandRail brands={snapshot.brands} selected={brand.domain} />

      {interrupted && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-brand-pink/40 bg-brand-blush/30 py-3">
          <p className="flex items-center gap-2 text-sm text-ink-800">
            <ClockIcon className="h-4 w-4 text-ink-500" />
            An earlier run of {brand.name} stopped at &ldquo;{stageDef(marker.stage).title}&rdquo; — {brand.inCorpus - brand.extracted} ads still to do. Nothing is lost; picking it up costs no credits.
          </p>
          <span className="flex gap-2">
            <button type="button" className="btn btn-ghost text-xs" onClick={clear}>Dismiss</button>
            {canRun && <button type="button" className="btn btn-primary text-xs" onClick={resumeRun}>Resume</button>}
          </span>
        </div>
      )}

      <Outcomes brand={brand} hasPlaybook={Boolean(snapshot.lastPlaybook)} />

      <RunHero
        brand={brand}
        snapshot={snapshot}
        run={engine.run}
        canRun={canRun}
        busy={engine.busy}
        stopping={engine.stopping}
        tabHidden={tabHidden}
        now={now}
        onRun={() => setConfirming(true)}
        onStop={engine.stop}
        onDismiss={engine.dismiss}
      />

      <StageStepper
        snapshot={snapshot}
        brand={brand}
        run={engine.run}
        canRun={canRun}
        busy={engine.busy}
        advanced={advanced}
        options={options}
        onToggleAdvanced={setAdvanced}
        onRunStage={(stage) => void engine.runSingleStage(stage, brand.domain, options[stage])}
        onOption={(stage, patch) => setOptions((current) => ({ ...current, [stage]: { ...current[stage], ...patch } }))}
      />

      <TeardownCard
        snapshot={snapshot}
        brand={brand}
        run={engine.run}
        canRun={canRun}
        busy={engine.busy}
        stopping={engine.stopping}
        onRun={() => void engine.runSingleStage("teardown", brand.domain, options.teardown)}
        onStop={engine.stop}
      />

      {!canRun && (
        <p className="text-sm text-ink-500">View only. Running a brand spends credits and model budget, so only creative strategists can start it.</p>
      )}

      {confirming && (
        <RunCostDialog brand={brand} snapshot={snapshot} onConfirm={startPipeline} onCancel={() => setConfirming(false)} />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MinerTabs active="run" />
        <Link href="/miner/results" className="inline-flex items-center gap-1 text-sm text-ink-500 transition hover:text-ink-900">
          Results <ArrowIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="max-w-2xl">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-pink" />Corpus Miner
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">Learn a competitor&apos;s playbook</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
          Pick a competitor and press one button. It finds their winning ads, watches every one, works out how they are built and how they are written, and hands you a playbook you can write from.
        </p>
      </div>
    </div>
  );
}
