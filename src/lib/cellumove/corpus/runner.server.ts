import "server-only";

// The /miner run page drives the pipeline one ad per request so no single call
// can outlive a serverless time limit, and closing the tab simply stops after
// the ads in flight. Every step calls exactly what the CLI runner for that
// stage calls; stages are idempotent, so "Run" again resumes where it stopped.

import { CORPUS_TAXONOMY_VERSION, MINE_MIN_SUPPORT } from "./constants";
import { latestGate1 } from "./eval.server";
import { extractAdBeats } from "./extract.server";
import { downloadAdMedia, loadAdMedia } from "./media.server";
import { mineAndSaveReports } from "./mine.server";
import { buildAndSavePlaybook } from "./playbook.server";
import { planTeardown, selectStageRows, type AdStage, type QueueOptions } from "./queue";
import { loadCompetitorAds, loadCorpusState } from "./state.server";
import { teardownCostUsd } from "./teardown";
import { loadAdTeardown, loadAdTeardowns, submitAdTeardown, syncAdTeardown } from "./teardown.server";
import { latestCompleteTranscriptRun, transcribeAd } from "./transcribe.server";
import { refreshWinnerScores } from "./winner-score.server";
import { collectWinners } from "./winners.server";

export type QueueItem = { id: string; brandName: string; winnerScore: number | null };

export type StepOutcome = "done" | "skipped" | "failed" | "quarantined" | "queued" | "processing";

export type StepResult = { adId: string; outcome: StepOutcome; detail: string; costUsd: number | null };

export type StepOptions = { force?: boolean; retryReview?: boolean; skipGate?: boolean };

const mb = (bytes: number | null | undefined) => `${((bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`;

/** Model runs record `usage.estimatedCostUsd`; older rows may not. */
function usageCostUsd(usage: unknown): number | null {
  if (!usage || typeof usage !== "object" || !("estimatedCostUsd" in usage)) return null;
  const value = (usage as { estimatedCostUsd?: unknown }).estimatedCostUsd;
  return typeof value === "number" ? value : null;
}

/** The ads a stage would process next, best winnerScore first. */
export async function stageQueue(stage: AdStage, options: QueueOptions = {}): Promise<QueueItem[]> {
  // Teardown picks the top quarter by rank, so the ranks must be current. Scoped
  // to the brand: concept-reuse fingerprints are already keyed per brand, so a
  // brand-scoped rescore gives the same numbers as a full-table one.
  if (stage === "teardown") await refreshWinnerScores({ brand: options.brand ?? undefined });
  const state = await loadCorpusState();
  const rows = stage === "teardown"
    ? planTeardown(state.rows, await loadAdTeardowns(), options).todo
    : selectStageRows(stage, state.rows, options);
  return rows.map((row) => ({ id: row.id, brandName: row.brandName, winnerScore: row.winnerScore }));
}

/** Refuses extraction until Gate 1 has passed, unless the caller opts into test mode. */
export async function assertExtractAllowed(skipGate: boolean): Promise<void> {
  const gate = await latestGate1(CORPUS_TAXONOMY_VERSION);
  if (gate?.passed || skipGate) return;
  throw new Error("The extractor has not passed its accuracy check (Gate 1). Turn on test mode to extract anyway.");
}

async function loadAd(adId: string) {
  const [ad] = await loadCompetitorAds({ ids: [adId] });
  if (!ad) throw new Error(`Ad ${adId} not found.`);
  return ad;
}

/** One stage for one ad. Per-ad problems come back as outcomes; only misuse throws. */
export async function runAdStep(stage: AdStage, adId: string, options: StepOptions = {}): Promise<StepResult> {
  const ad = await loadAd(adId);
  const result = (outcome: StepOutcome, detail: string, costUsd: number | null = null): StepResult => ({ adId, outcome, detail, costUsd });
  try {
    if (stage === "media") {
      const media = await downloadAdMedia(ad, { force: options.force });
      return media.status === "downloaded"
        ? result("done", `${mb(media.bytes)} · ${media.mime}`)
        : result("failed", `${media.status}${media.statusReason ? ` — ${media.statusReason}` : ""}`);
    }

    if (stage === "transcribe") {
      const media = await loadAdMedia(ad.id);
      if (media?.status !== "downloaded") return result("failed", "Video not downloaded yet.");
      const run = await transcribeAd(ad, media, { force: options.force });
      if (run.reused) return result("skipped", "Already transcribed.");
      const vo = run.segments.filter((segment) => segment.channel === "vo").length;
      const detail = `${run.run.durationSec != null ? `${Math.round(run.run.durationSec)}s · ` : ""}${vo} spoken · ${run.segments.length - vo} on-screen · ${run.run.language ?? "?"}`;
      return result(run.run.status === "complete" ? "done" : "failed", run.run.status === "complete" ? detail : run.run.errorSummary ?? "Transcription failed.", usageCostUsd(run.run.usage));
    }

    if (stage === "extract") {
      await assertExtractAllowed(Boolean(options.skipGate));
      const transcript = await latestCompleteTranscriptRun(ad.id);
      if (!transcript) return result("failed", "No transcript yet.");
      const run = await extractAdBeats(ad, transcript, { force: options.force, retryReview: options.retryReview });
      if (run.reused) return result("skipped", run.run.status === "needs_human_review" ? "Waiting for human review." : "Already broken into beats.");
      const cost = usageCostUsd(run.run.usage);
      if (run.run.status === "needs_human_review") return result("quarantined", run.run.errorSummary?.slice(0, 200) ?? "Quotes did not match the transcript.", cost);
      if (run.run.status !== "complete") return result("failed", run.run.errorSummary ?? "Extraction failed.", cost);
      return result("done", `${run.beats.length} beats · ${run.beats.map((beat) => beat.code).join(" → ")}`, cost);
    }

    const existing = await loadAdTeardown(ad.id);
    const saved = await submitAdTeardown(ad, existing);
    return result("queued", `Sent to Teardown${saved.sourceKind === "stored_copy" ? " (stored copy)" : ""}`);
  } catch (error) {
    return result("failed", error instanceof Error ? error.message : String(error));
  }
}

/** Poll Teardown for the given ads and report where each one is. */
export async function syncTeardowns(adIds: string[]): Promise<StepResult[]> {
  const rows = await loadAdTeardowns({ ids: adIds });
  return Promise.all(rows.map(async (row): Promise<StepResult> => {
    try {
      const synced = row.status === "queued" || row.status === "processing" ? await syncAdTeardown(row) : row;
      if (synced.status === "completed") return { adId: row.competitorAdId, outcome: "done", detail: "Workbook ready", costUsd: teardownCostUsd(synced) };
      if (synced.status === "failed") return { adId: row.competitorAdId, outcome: "failed", detail: `${synced.errorCode ?? "failed"}${synced.errorMessage ? ` — ${synced.errorMessage}` : ""}`, costUsd: null };
      return { adId: row.competitorAdId, outcome: synced.status, detail: synced.status === "processing" ? "Teardown is reading the video…" : "Waiting in Teardown's queue…", costUsd: null };
    } catch (error) {
      return { adId: row.competitorAdId, outcome: "processing", detail: `Could not reach Teardown, will retry (${error instanceof Error ? error.message : String(error)})`, costUsd: null };
    }
  }));
}

export type BatchResult = { title: string; lines: string[] };

export async function runWinners(input: { brand?: string | null; target?: number }): Promise<BatchResult> {
  const result = await collectWinners({ brand: input.brand, target: input.target });
  const spread = [...result.perBrand].filter((brand) => brand.picked > 0).sort((a, b) => b.picked - a.picked).map((brand) => `${brand.domain} ${brand.picked}`);
  return {
    title: result.brand
      ? `${result.rows.length} winning ads for ${result.brand}`
      : `${result.rows.length} winners from ${spread.length} competitors`,
    lines: [
      result.brand
        ? `Launched on or before ${result.cutoff} and still running · highest spend first`
        : `Launched on or before ${result.cutoff} and still running · per brand: ${spread.join(" · ")}`,
      result.empty.length
        ? `No qualifying winners yet: ${result.empty.join(", ")}`
        : result.brand ? "" : "Every tracked competitor contributed.",
      `${result.newIds.length} new ads · ${result.excluded} earlier ads left this brand's corpus (kept, not deleted)`,
      `BrandSearch credits used: ${result.creditsUsed} · ${result.monthlyRemaining ?? "?"} left this month`,
      "Download the videos next — the links expire in 3 days.",
    ].filter(Boolean),
  };
}

export async function runScore(input: { brand?: string | null } = {}): Promise<BatchResult> {
  const result = await refreshWinnerScores({ brand: input.brand ?? undefined });
  return { title: `${result.scored} ads ranked${input.brand ? ` for ${input.brand}` : ""}`, lines: [`${result.updated} rank(s) changed.`] };
}

export async function runMine(input: { brand?: string | null } = {}): Promise<BatchResult> {
  const result = await mineAndSaveReports({ brand: input.brand });
  const report = input.brand ? result.brand : result.all;
  if (!report) {
    return {
      title: "Nothing to mine yet",
      lines: [input.brand
        ? `Break at least ${MINE_MIN_SUPPORT} of ${input.brand}'s ads into beats first.`
        : "Break at least a few ads into beats first."],
    };
  }
  return {
    title: `Patterns mined from ${report.adCount} ${input.brand ? `${input.brand} ` : ""}ads`,
    lines: [
      `${report.codeFrequency.length} beat types · ${report.positionalLaws.codes.length} ordering laws · ${report.sequences.codeSpines.length} common sequences`,
      report.lift.status === "scored" ? `Winners vs. the rest compared on ${report.lift.nTop} top and ${report.lift.nBottom} bottom ads.` : `Winners vs. the rest needs ${report.lift.minimum}+ ranked ads.`,
      `${result.written} report(s) saved · ${result.unchanged} unchanged · cohorts: ${result.cohorts.join(", ") || "all"}`,
    ],
  };
}

export async function runPlaybook(input: { brand: string }): Promise<BatchResult> {
  const result = await buildAndSavePlaybook(input.brand);
  if (!result.playbook) {
    return { title: "No playbook yet", lines: [`Break some of ${input.brand}'s ads into beats first.`] };
  }
  const playbook = result.playbook;
  return {
    title: `Playbook for ${input.brand}: ${playbook.adCount} ads`,
    lines: [
      `${playbook.hooks.length} hook types · ${playbook.beats.length} beats · ${playbook.copy.rules.length} copywriting rules · ${playbook.formats.length} formats · ${playbook.concepts.length} concepts`,
      result.written ? "Saved a new snapshot." : "Unchanged since the last snapshot.",
      ...playbook.caveats.slice(0, 2),
    ],
  };
}

/** Teardowns still running — lets the page resume polling after a reload. */
export async function pendingTeardownIds(brand?: string | null): Promise<string[]> {
  const pending = await loadAdTeardowns({ pendingOnly: true });
  if (!brand) return pending.map((row) => row.competitorAdId);
  const state = await loadCorpusState();
  const ofBrand = new Set(state.rows.filter((row) => row.brandName.toLowerCase() === brand.toLowerCase()).map((row) => row.id));
  return pending.map((row) => row.competitorAdId).filter((id) => ofBrand.has(id));
}
