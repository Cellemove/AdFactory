import type { BrandSummary } from "@/lib/cellumove/corpus/brand-progress";
import type { QueueItem, StepOutcome } from "@/lib/cellumove/corpus/runner.server";

export type { BrandSummary, QueueItem, StepOutcome };

export type StageKey = "ingest" | "media" | "transcribe" | "extract" | "score" | "mine" | "playbook" | "teardown";
/** Stages that run one request per ad. */
export type AdStageKey = "media" | "transcribe" | "extract" | "teardown";
/** What the single "Run everything" button chains, in order. Teardown is paid and stays out. */
export type PipelineStepKey = Exclude<StageKey, "teardown">;

export type StageStats = {
  ready: number;
  done: number;
  failed: number;
  total: number;
  review?: number;
  lastRunAt?: string | null;
};

export type RunSnapshot = {
  researchMode?: "speech_only" | "full_video";
  researchEnabled?: boolean;
  /** The brand being worked on, or null on the "pick a brand" screen. */
  brand: BrandSummary | null;
  brands: BrandSummary[];
  /** Spectre could not be reached; the rail shows only brands already in the corpus. */
  competitorsUnavailable: boolean;
  gate: { passed: boolean; summary: string };
  stages: Record<StageKey, StageStats>;
  pendingTeardowns: QueueItem[];
  /** Newest mined snapshot for this brand, for the "patterns" row. */
  lastMined: { at: string; adCount: number } | null;
  /** Newest playbook for this brand, for the "playbook" row and the summary link. */
  lastPlaybook: { at: string; adCount: number } | null;
  defaultTarget: number;
  issues?: Partial<Record<AdStageKey, RunRow[]>>;
};

export type RowStatus = "waiting" | "running" | StepOutcome;
export type RunRow = QueueItem & { status: RowStatus; detail?: string; costUsd?: number | null };

export type StageProgress = {
  key: StageKey;
  status: "waiting" | "running" | "done" | "skipped" | "failed" | "stopped";
  total: number;
  settled: number;
  failed: number;
  review: number;
  costUsd: number;
  note?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type RunPhase = "running" | "finished" | "partial" | "stopped" | "error";

export type PipelineRun = {
  brand: string;
  /** Whether this run collected fresh ads or reused the ones already in the corpus. */
  collected: boolean;
  phase: RunPhase;
  current: StageKey | null;
  order: StageKey[];
  stages: Partial<Record<StageKey, StageProgress>>;
  /** Per-ad detail for the stage currently running. */
  rows: RunRow[];
  startedAt: number;
  finishedAt?: number;
  creditsUsed: number;
  error?: string;
  /** Lines from the batch stages (collect / rank / patterns). */
  notes: string[];
};

export type PipelineOptions = {
  brand: string;
  target: number;
  includeCollect: boolean;
  /** Extract refuses to run until Gate 1 passes unless this is set. */
  skipGate: boolean;
};

/** Advanced mode: options for running a single stage by hand. */
export type StageOptions = {
  limit: number | null;
  force: boolean;
  retryReview: boolean;
  skipGate: boolean;
  target: number;
};
