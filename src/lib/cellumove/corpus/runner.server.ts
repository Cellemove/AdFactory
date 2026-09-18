import "server-only";

import { supabase } from "@/lib/db";
import { BRANDSEARCH_MEDIA_TTL_MS, type NormalizedBrandSearchAd } from "@/lib/brandsearch";
import { competitorAdId, toCompetitorAdRow } from "./ingest";
import { pickNew, RECENT_DAILY_CAP, RECENT_MAX_DAYS, RECENT_MIN_DAYS, RECENT_POOL_FACTOR } from "./winners";

// The /miner/run page drives the pipeline one ad per request so no single call
// can outlive a serverless time limit, and closing the tab simply stops after
// the ads in flight. Every step calls exactly what the CLI runner for that
// stage calls; stages are idempotent, so "Run" again resumes where it stopped.

import { CORPUS_TAXONOMY_VERSION } from "./constants";
import { latestGate1 } from "./eval.server";
import { extractAdBeats } from "./extract.server";
import { downloadAdMedia, loadAdMedia } from "./media.server";
import { mineAndSaveReports } from "./mine.server";
import { planTeardown, selectStageRows, type AdStage, type QueueOptions } from "./queue";
import { loadCompetitorAds, loadCorpusState } from "./state.server";
import { teardownCostUsd, teardownSourceFor } from "./teardown";
import { loadAdTeardown, loadAdTeardowns, submitAdTeardown, syncAdTeardown } from "./teardown.server";
import { latestCompleteTranscriptRun, transcribeAd } from "./transcribe.server";
import { refreshWinnerScores } from "./winner-score.server";
import { collectWinners, fetchWinnerPool } from "./winners.server";

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
  if (stage === "teardown") await refreshWinnerScores();
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

export async function runWinners(target: number): Promise<BatchResult> {
  const result = await collectWinners({ target });
  const brands = result.perBrand.filter((brand) => brand.picked > 0).length;
  const spread = [...result.perBrand].filter((brand) => brand.picked > 0).sort((a, b) => b.picked - a.picked).map((brand) => `${brand.domain} ${brand.picked}`);
  return {
    title: `${result.rows.length} winners from ${brands} competitors`,
    lines: [
      `Launched on or before ${result.cutoff} and still running · per brand: ${spread.join(" · ")}`,
      result.empty.length ? `No qualifying winners yet: ${result.empty.join(", ")}` : "Every tracked competitor contributed.",
      `${result.newIds.length} new ads · ${result.excluded} earlier ads left the corpus (kept, not deleted)`,
      `BrandSearch credits used: ${result.creditsUsed} · ${result.monthlyRemaining ?? "?"} left this month`,
      "Download the videos next — the links expire in 3 days.",
    ],
  };
}

export async function runScore(): Promise<BatchResult> {
  const result = await refreshWinnerScores();
  return { title: `${result.scored} ads ranked`, lines: [`${result.updated} rank(s) changed.`] };
}

export async function runMine(): Promise<BatchResult> {
  const result = await mineAndSaveReports();
  if (!result.all) return { title: "Nothing to mine yet", lines: ["Break at least a few ads into beats first."] };
  const report = result.all;
  return {
    title: `Patterns mined from ${report.adCount} ads`,
    lines: [
      `${report.codeFrequency.length} beat types · ${report.positionalLaws.codes.length} ordering laws · ${report.sequences.codeSpines.length} common sequences`,
      report.lift.status === "scored" ? `Winners vs. the rest compared on ${report.lift.nTop} top and ${report.lift.nBottom} bottom ads.` : `Winners vs. the rest needs ${report.lift.minimum}+ ranked ads.`,
      `${result.written} report(s) saved · ${result.unchanged} unchanged · cohorts: ${result.cohorts.join(", ") || "all"}`,
    ],
  };
}

/** Existing Teardown rows for the plan's pending winners — lets the page resume polling. */
export async function pendingTeardownIds(): Promise<string[]> {
  return (await loadAdTeardowns({ pendingOnly: true })).map((row) => row.competitorAdId);
}

/** Shared guard for Spy and the daily job. Failed jobs are retried only by hand. */
export async function deconstructAd(adId: string): Promise<StepResult> {
  const result = (outcome: StepOutcome, detail: string): StepResult => ({ adId, outcome, detail, costUsd: null });
  try {
    const ad = await loadAd(adId);
    if (ad.mediaType !== "video") return result("skipped", "Not a video");
    const existing = await loadAdTeardown(adId);
    if (existing?.status === "completed") return result("done", "Already deconstructed");
    if (existing?.status === "queued" || existing?.status === "processing") return result(existing.status, "Already deconstructing");
    if (!teardownSourceFor(ad, await loadAdMedia(adId))) return result("skipped", "Video link expired — refresh the feed");
    const saved = await submitAdTeardown(ad, existing);
    return result(saved.status === "completed" ? "done" : saved.status, "Submitted to Teardown");
  } catch (error) {
    return result("failed", error instanceof Error ? error.message : String(error));
  }
}

export async function runRecentWinners(input: { cap?: number; dryRun?: boolean; budgetMs?: number } = {}) {
  const started = Date.now();
  const rawCap = input.cap ?? Number(process.env.RECENT_WINNERS_DAILY_CAP?.trim() || RECENT_DAILY_CAP);
  if (!Number.isFinite(rawCap)) throw new Error("RECENT_WINNERS_DAILY_CAP must be a number.");
  const cap = Math.max(0, Math.min(RECENT_DAILY_CAP, Math.floor(rawCap)));
  const budgetMs = input.budgetMs ?? 450_000;
  if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new Error("budgetMs must be a non-negative number.");
  const synced = await syncTeardowns(await pendingTeardownIds());
  const midnight = new Date(started).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const count = await supabase.from("AdTeardown").select("id", { count: "exact", head: true }).gte("submittedAt", midnight);
  if (count.error) throw new Error(count.error.message);
  const remaining = Math.max(0, cap - (count.count ?? 0));
  const summary = {
    cap, submittedToday: count.count ?? 0, remaining, dryRun: Boolean(input.dryRun),
    reason: "", creditsUsed: 0, dailyRemaining: null as number | null, monthlyRemaining: null as number | null,
    synced: synced.length, results: [] as StepResult[],
    candidates: [] as Array<{ adId: string; brand: string; startedAt: string | null }>,
  };
  const finish = (reason: string) => {
    summary.reason = reason;
    console.log("[recent-winners]", JSON.stringify(summary));
    return summary;
  };
  if (!remaining) return finish(cap === 0 ? "Disabled (sync complete)" : "Day cap reached");
  if (Date.now() - started >= budgetMs) return finish("Time budget reached");
  // ponytail: pool = 4×cap; raise the factor if days return 0 new while brands still qualify.
  const pool = await fetchWinnerPool({ target: cap * RECENT_POOL_FACTOR, minDays: RECENT_MIN_DAYS, maxDays: RECENT_MAX_DAYS, videoOnly: true });
  summary.creditsUsed = pool.creditsUsed;
  summary.dailyRemaining = pool.dailyRemaining;
  summary.monthlyRemaining = pool.monthlyRemaining;
  const idOf = (ad: NormalizedBrandSearchAd) => competitorAdId(ad.provider, ad.platform.toLowerCase(), ad.externalId);
  const ids = [...pool.picked.values()].flat().map(idOf);
  const done = new Set((await loadAdTeardowns({ ids })).map((row) => row.competitorAdId));
  const todo = pickNew(pool.picked, done, remaining, idOf, (ad) => typeof ad.metrics.euTotalSpend === "number" ? ad.metrics.euTotalSpend : 0);
  summary.candidates = todo.map((ad) => ({ adId: idOf(ad), brand: ad.brandDomain || ad.brandName, startedAt: ad.startedAt }));
  if (input.dryRun) return finish("Dry run — no ads submitted");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, async () => {
    while (cursor < todo.length && Date.now() - started < budgetMs) {
      const ad = todo[cursor++]!;
      const now = new Date();
      try {
        // Write only ads that will start. This mapper never changes corpus membership.
        const row = toCompetitorAdRow(ad, now.toISOString(), new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString());
        const write = await supabase.from("CompetitorAd").upsert(row, { onConflict: "provider,platform,externalId", ignoreDuplicates: false });
        if (write.error) throw new Error(write.error.message);
        summary.results.push(await deconstructAd(row.id));
      } catch (error) {
        summary.results.push({ adId: idOf(ad), outcome: "failed", detail: error instanceof Error ? error.message : String(error), costUsd: null });
      }
    }
  }));
  return finish(cursor < todo.length ? "Time budget reached" : "Complete");
}
