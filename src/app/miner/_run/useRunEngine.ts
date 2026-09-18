"use client";

// The one-click run. It stays in the browser on purpose: transcribing and
// beating 100 ads takes tens of minutes, and driving one ad per request is what
// keeps every call well inside the serverless limit. Closing the tab stops
// after the ads in flight; every stage is idempotent, so Run again resumes.

import { useCallback, useRef, useState } from "react";
import { fetchQueue, isBatchStage, runBatchStage, runStep, syncTeardowns } from "./api";
import { PIPELINE_PLAN, stageDef } from "./stages";
import { finishedPhase } from "./progress";
import type { AdStageKey, PipelineOptions, PipelineRun, QueueItem, RunRow, StageKey, StageOptions, StageProgress } from "./types";

const TEARDOWN_POLL_MS = 15_000;

const blankProgress = (key: StageKey): StageProgress => ({
  key, status: "waiting", total: 0, settled: 0, failed: 0, review: 0, costUsd: 0,
});

export type RunEngine = {
  run: PipelineRun | null;
  busy: boolean;
  stopping: boolean;
  runPipeline(options: PipelineOptions): Promise<void>;
  runSingleStage(stage: StageKey, brand: string, options: StageOptions): Promise<void>;
  watchPendingTeardowns(brand: string, items: QueueItem[]): Promise<void>;
  stop(): void;
  dismiss(): void;
};

export function useRunEngine(onCorpusChanged: () => void): RunEngine {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);
  const busy = run?.phase === "running";

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

  const dismiss = useCallback(() => setRun(null), []);

  const patchStage = useCallback((key: StageKey, patch: Partial<StageProgress>) => {
    setRun((current) => current && ({
      ...current,
      stages: { ...current.stages, [key]: { ...(current.stages[key] ?? blankProgress(key)), ...patch } },
    }));
  }, []);

  const patchRow = useCallback((adId: string, patch: Partial<RunRow>) => {
    setRun((current) => current && ({
      ...current,
      rows: current.rows.map((row) => (row.id === adId ? { ...row, ...patch } : row)),
    }));
  }, []);

  /** Runs one per-ad stage over its queue on the stage's lanes. */
  const runAdStage = useCallback(async (stage: AdStageKey, brand: string, options: { limit?: number | null; force?: boolean; retryReview?: boolean; skipGate?: boolean }) => {
    const def = stageDef(stage);
    const items = await fetchQueue({ stage, brand, limit: options.limit ?? null, force: options.force, retryReview: options.retryReview });
    if (!items.length) {
      // Nothing waiting is success, not failure — this is what makes Run a resume.
      patchStage(stage, { status: "skipped", note: "Nothing to do", finishedAt: Date.now() });
      return { items, costUsd: 0 };
    }

    setRun((current) => current && ({ ...current, rows: items.map((item) => ({ ...item, status: "waiting" as const })) }));
    patchStage(stage, { status: "running", total: items.length, settled: 0, failed: 0, review: 0, startedAt: Date.now() });

    let cursor = 0;
    let costUsd = 0;
    let failed = 0;
    let review = 0;
    const lane = async () => {
      while (!stopRef.current && cursor < items.length) {
        const item = items[cursor++]!;
        patchRow(item.id, { status: "running" });
        try {
          const result = await runStep({ stage, adId: item.id, force: options.force, retryReview: options.retryReview, skipGate: options.skipGate });
          costUsd += result.costUsd ?? 0;
          if (result.outcome === "failed") failed += 1;
          if (result.outcome === "quarantined") review += 1;
          patchRow(item.id, { status: result.outcome, detail: result.detail, costUsd: result.costUsd });
          setRun((current) => {
            if (!current) return current;
            const progress = current.stages[stage] ?? blankProgress(stage);
            return {
              ...current,
              stages: {
                ...current.stages,
                [stage]: {
                  ...progress,
                  settled: progress.settled + 1,
                  failed: progress.failed + (result.outcome === "failed" ? 1 : 0),
                  review: progress.review + (result.outcome === "quarantined" ? 1 : 0),
                  costUsd: progress.costUsd + (result.costUsd ?? 0),
                },
              },
            };
          });
        } catch (error) {
          failed += 1;
          // A per-ad failure never stops the run; a stage-level failure (the queue
          // call) throws before we get here and does.
          patchRow(item.id, { status: "failed", detail: error instanceof Error ? error.message : String(error) });
          setRun((current) => {
            if (!current) return current;
            const progress = current.stages[stage] ?? blankProgress(stage);
            return { ...current, stages: { ...current.stages, [stage]: { ...progress, settled: progress.settled + 1, failed: progress.failed + 1 } } };
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(def.lanes ?? 2, items.length) }, lane));
    patchStage(stage, { status: stopRef.current ? "stopped" : failed || review ? "failed" : "done", finishedAt: Date.now() });
    return { items, costUsd };
  }, [patchRow, patchStage]);

  /** Poll Teardown until every submitted ad is finished, or Stop is pressed. */
  const watchTeardowns = useCallback(async (adIds: string[]) => {
    let pending = adIds;
    while (pending.length && !stopRef.current) {
      await sleep(TEARDOWN_POLL_MS);
      if (stopRef.current) break;
      try {
        const results = await syncTeardowns(pending);
        for (const result of results) patchRow(result.adId, { status: result.outcome, detail: result.detail, costUsd: result.costUsd });
        const done = results.filter((result) => result.outcome === "done").length;
        const failed = results.filter((result) => result.outcome === "failed").length;
        patchStage("teardown", { settled: done + failed, failed, costUsd: results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0) });
        pending = results.filter((result) => result.outcome === "queued" || result.outcome === "processing").map((result) => result.adId);
      } catch {
        // Teardown or the network hiccuped — keep watching.
      }
    }
  }, [patchRow, patchStage, sleep]);

  const runPipeline = useCallback(async (options: PipelineOptions) => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setStopping(false);
    const order: StageKey[] = options.includeCollect ? [...PIPELINE_PLAN] : PIPELINE_PLAN.filter((key) => key !== "ingest");
    setRun({
      brand: options.brand,
      collected: options.includeCollect,
      phase: "running",
      current: order[0] ?? null,
      order,
      stages: Object.fromEntries(order.map((key) => [key, blankProgress(key)])),
      rows: [],
      startedAt: Date.now(),
      creditsUsed: 0,
      notes: [],
    });

    try {
      for (const stage of order) {
        if (stopRef.current) break;
        setRun((current) => current && ({ ...current, current: stage, rows: [] }));

        if (isBatchStage(stage)) {
          patchStage(stage, { status: "running", startedAt: Date.now() });
          const batch = await runBatchStage(stage, { brand: options.brand, target: options.target });
          patchStage(stage, { status: batch.incomplete ? "failed" : "done", note: batch.title, finishedAt: Date.now() });
          setRun((current) => current && ({ ...current, notes: [...current.notes, `${batch.title}`, ...batch.lines] }));
          // The corpus and the brand rail change the moment ads are collected.
          if (stage === "ingest") onCorpusChanged();
          continue;
        }

        await runAdStage(stage, options.brand, { limit: null, skipGate: options.skipGate });
      }
      setRun((current) => current && ({
        ...current,
        phase: stopRef.current ? "stopped" : finishedPhase(current),
        current: null,
        finishedAt: Date.now(),
      }));
    } catch (error) {
      setRun((current) => current && ({
        ...current,
        phase: "error",
        current: null,
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      runningRef.current = false;
      setStopping(false);
      onCorpusChanged();
    }
  }, [onCorpusChanged, patchStage, runAdStage]);

  /** Advanced mode: run exactly one stage, the way the page did before. */
  const runSingleStage = useCallback(async (stage: StageKey, brand: string, options: StageOptions) => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setStopping(false);
    setRun({
      brand,
      collected: stage === "ingest",
      phase: "running",
      current: stage,
      order: [stage],
      stages: { [stage]: blankProgress(stage) },
      rows: [],
      startedAt: Date.now(),
      creditsUsed: 0,
      notes: [],
    });
    try {
      if (isBatchStage(stage)) {
        patchStage(stage, { status: "running", startedAt: Date.now() });
        const batch = await runBatchStage(stage, { brand, target: options.target });
        patchStage(stage, { status: batch.incomplete ? "failed" : "done", note: batch.title, finishedAt: Date.now() });
        setRun((current) => current && ({ ...current, notes: [batch.title, ...batch.lines] }));
      } else {
        const { items } = await runAdStage(stage, brand, options);
        if (stage === "teardown" && items.length && !stopRef.current) {
          await watchTeardowns(items.map((item) => item.id));
        }
      }
      setRun((current) => current && ({ ...current, phase: stopRef.current ? "stopped" : finishedPhase(current), current: null, finishedAt: Date.now() }));
    } catch (error) {
      setRun((current) => current && ({ ...current, phase: "error", current: null, finishedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }));
    } finally {
      runningRef.current = false;
      setStopping(false);
      onCorpusChanged();
    }
  }, [onCorpusChanged, patchStage, runAdStage, watchTeardowns]);

  /** Teardowns submitted earlier are still running: pick them back up on load. */
  const watchPendingTeardowns = useCallback(async (brand: string, items: QueueItem[]) => {
    if (!items.length) return;
    stopRef.current = false;
    setRun({
      brand,
      collected: false,
      phase: "running",
      current: "teardown",
      order: ["teardown"],
      stages: { teardown: { ...blankProgress("teardown"), status: "running", total: items.length, startedAt: Date.now() } },
      rows: items.map((item) => ({ ...item, status: "processing" as const, detail: "Waiting for Teardown…" })),
      startedAt: Date.now(),
      creditsUsed: 0,
      notes: [],
    });
    await watchTeardowns(items.map((item) => item.id));
    setRun((current) => current && ({ ...current, phase: stopRef.current ? "stopped" : "finished", current: null, finishedAt: Date.now() }));
    onCorpusChanged();
  }, [onCorpusChanged, watchTeardowns]);

  return { run, busy, stopping, runPipeline, runSingleStage, watchPendingTeardowns, stop, dismiss };
}
