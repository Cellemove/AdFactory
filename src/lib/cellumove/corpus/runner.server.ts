import "server-only";
import { brandSearchResearchEnabled, defaultResearchMode, importAdResearch } from "@/lib/brandsearch-research.server";
import type { ResearchMode } from "@/lib/brandsearch-research";

import { supabase } from "@/lib/db";
import { BRANDSEARCH_MEDIA_TTL_MS, type NormalizedBrandSearchAd } from "@/lib/brandsearch";
import { competitorAdId, toCompetitorAdRow } from "./ingest";
import { spendWarning, todaySpendUsd } from "@/lib/usage";
import { pickNew, RECENT_DAILY_CAP, RECENT_MAX_DAYS, RECENT_MIN_DAYS, RECENT_POOL_FACTOR, teardownSkipReason } from "./winners";

// The /miner/run page drives the pipeline one ad per request so no single call
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
import { teardownCostUsd, teardownSourceFor } from "./teardown";
import { loadAdTeardown, loadAdTeardowns, submitAdTeardown, syncAdTeardown } from "./teardown.server";
import { importResearchTranscript, latestCompleteTranscriptRun, transcribeAd } from "./transcribe.server";
import { refreshWinnerScores } from "./winner-score.server";
import { collectWinners, fetchWinnerPool } from "./winners.server";

export type QueueItem = { id: string; brandName: string; winnerScore: number | null };

export type StepOutcome = "done" | "skipped" | "failed" | "quarantined" | "queued" | "processing";

export type StepResult = { adId: string; outcome: StepOutcome; detail: string; costUsd: number | null; creditsUsed?: number; researchSnapshotId?: string };

export type StepOptions = { mode?: ResearchMode; force?: boolean; retryReview?: boolean; skipGate?: boolean };

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
  options = { ...options, mode: options.mode ?? defaultResearchMode() };
  const state = await loadCorpusState(options.mode);
  const rows = stage === "teardown"
    ? planTeardown(state.rows, await loadAdTeardowns(), options).todo
    : selectStageRows(stage, state.rows, options);
  return rows.map((row) => ({ id: row.id, brandName: row.brandName, winnerScore: row.winnerScore }));
}

/** Refuses extraction until Gate 1 has passed, unless the caller opts into test mode. */
export async function assertExtractAllowed(skipGate: boolean, mode: ResearchMode = defaultResearchMode()): Promise<void> {
  const gate = await latestGate1(CORPUS_TAXONOMY_VERSION, mode);
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
  const mode = options.mode ?? defaultResearchMode();
  const result = (outcome: StepOutcome, detail: string, costUsd: number | null = null): StepResult => ({ adId, outcome, detail, costUsd });
  try {
    if (stage === "media") {
      const media = await downloadAdMedia(ad, { force: options.force });
      return media.status === "downloaded"
        ? result("done", `${mb(media.bytes)} · ${media.mime}`)
        : result("failed", `${media.status}${media.statusReason ? ` — ${media.statusReason}` : ""}`);
    }

    if (stage === "transcribe" && mode === "speech_only") {
      const imported = await importAdResearch(ad);
      const run = imported.snapshot ? await importResearchTranscript(ad, imported.snapshot) : null;
      return { ...result(run?.run.status === "complete" ? "done" : "queued", run ? `${run.segments.length} spoken segments · visuals unassessed` : "Research deferred; retry after the allowance resets or provider recovery."), creditsUsed: imported.creditsUsed, researchSnapshotId: imported.snapshot?.id };
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
      await assertExtractAllowed(Boolean(options.skipGate), mode);
      const transcript = await latestCompleteTranscriptRun(ad.id, mode);
      if (!transcript) return result("failed", "No transcript yet.");
      if (transcript.segmentCount === 0) return result("skipped", "Provider reports no speech; no copy beats to extract.");
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

export type BatchResult = { title: string; lines: string[]; incomplete?: boolean };

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

export async function runMine(input: { brand?: string | null; mode?: ResearchMode } = {}): Promise<BatchResult> {
  const result = await mineAndSaveReports({ brand: input.brand, mode: input.mode });
  const report = input.brand ? result.brand : result.all;
  if (!report) {
    return {
      title: "Nothing to mine yet",
      incomplete: true,
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

export async function runPlaybook(input: { brand: string; mode?: ResearchMode }): Promise<BatchResult> {
  const result = await buildAndSavePlaybook(input.brand, { mode: input.mode });
  if (!result.playbook) {
    return { title: "No playbook yet", incomplete: true, lines: [`Break some of ${input.brand}'s ads into beats first.`] };
  }
  const playbook = result.playbook;
  return {
    title: `Playbook for ${input.brand}: ${playbook.adCount} ads`,
    incomplete: playbook.coverage ? playbook.coverage.analyzedAds < playbook.coverage.totalAds : false,
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

/** Shared guard for Spy and the daily job. Failed jobs are retried only by hand. */
export async function deconstructAd(adId: string): Promise<StepResult> {
  const result = (outcome: StepOutcome, detail: string): StepResult => ({ adId, outcome, detail, costUsd: null });
  try {
    const ad = await loadAd(adId);
    if (ad.mediaType !== "video") return result("skipped", "Not a video");
    const existing = await loadAdTeardown(adId);
    if (existing?.status === "completed") return result("done", "Already deconstructed");
    if (existing?.status === "queued" || existing?.status === "processing") return result(existing.status, "Already deconstructing");
    const media = await loadAdMedia(adId);
    if (!teardownSourceFor(ad, media)) return result("skipped", "Video link expired — refresh the feed");
    // Same video under another ad id: never pay for it twice.
    if (media?.sha256) {
      const twin = await supabase.from("AdTeardown").select("competitorAdId").eq("mediaSha256", media.sha256).neq("competitorAdId", adId).limit(1).maybeSingle();
      if (twin.data) return result("skipped", `Same video already deconstructed (${twin.data.competitorAdId})`);
    }
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
  const research = brandSearchResearchEnabled();
  const count = research
    ? await supabase.from("BrandSearchReservation").select("competitorAdId", { count: "exact", head: true }).eq("scope", "daily_research").eq("day", midnight.slice(0, 10))
    : await supabase.from("AdTeardown").select("id", { count: "exact", head: true }).gte("submittedAt", midnight);
  if (count.error) throw new Error(count.error.message);
  const remaining = Math.max(0, cap - (count.count ?? 0));
  const summary = {
    cap, submittedToday: count.count ?? 0, remaining, dryRun: Boolean(input.dryRun),
    reason: "", creditsUsed: 0, transcriptCreditsUsed: 0, dailyRemaining: null as number | null, monthlyRemaining: null as number | null,
    synced: synced.length, results: [] as StepResult[],
    skipped: {} as Record<string, number>, spendTodayUsd: 0, spendWarning: null as string | null,
    candidates: [] as Array<{ adId: string; brand: string; startedAt: string | null }>,
  };
  const finish = async (reason: string) => {
    summary.reason = reason;
    summary.transcriptCreditsUsed = summary.results.reduce((sum, result) => sum + (result.creditsUsed ?? 0), 0);
    summary.spendTodayUsd = Math.round((await todaySpendUsd()) * 100) / 100;
    summary.spendWarning = spendWarning(summary.spendTodayUsd);
    console.log("[recent-winners]", JSON.stringify(summary));
    if (summary.spendWarning) console.warn("[recent-winners]", summary.spendWarning);
    return summary;
  };
  // Reconcile durable unfinished imports before selecting new daily candidates.
  if (research && cap > 0 && !input.dryRun) {
    const due = await supabase.from("AdResearchJob").select("competitorAdId").neq("status", "ready").or(`nextAttemptAt.is.null,nextAttemptAt.lte.${new Date().toISOString()}`).order("updatedAt").limit(10);
    if (due.error) throw new Error(due.error.message);
    for (const job of due.data ?? []) {
      if (Date.now() - started > budgetMs - 380_000) break;
      summary.results.push(await researchAd(job.competitorAdId));
    }
  }
  if (!remaining) return finish(cap === 0 ? "Disabled (sync complete)" : "Day cap reached");
  if (Date.now() - started >= budgetMs) return finish("Time budget reached");
  // ponytail: pool = 4×cap; raise the factor if days return 0 new while brands still qualify.
  const pool = await fetchWinnerPool({ target: cap * RECENT_POOL_FACTOR, minDays: RECENT_MIN_DAYS, maxDays: RECENT_MAX_DAYS, videoOnly: true });
  summary.creditsUsed = pool.creditsUsed;
  summary.dailyRemaining = pool.dailyRemaining;
  summary.monthlyRemaining = pool.monthlyRemaining;
  const idOf = (ad: NormalizedBrandSearchAd) => competitorAdId(ad.provider, ad.platform.toLowerCase(), ad.externalId);
  // Drop ads that are not worth a paid Teardown before the cap is filled; the
  // 4x pool tops the day back up from what is left.
  for (const [brand, ads] of pool.picked) {
    pool.picked.set(brand, ads.filter((ad) => {
      const reason = teardownSkipReason(ad);
      if (reason) summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
      return !reason;
    }));
  }
  const ids = [...pool.picked.values()].flat().map(idOf);
  const existingResearch = research && ids.length ? await supabase.from("AdResearchJob").select("competitorAdId").in("competitorAdId", ids) : null;
  if (existingResearch?.error) throw new Error(existingResearch.error.message);
  const done = new Set(research ? (existingResearch?.data ?? []).map((row) => row.competitorAdId) : (await loadAdTeardowns({ ids })).map((row) => row.competitorAdId));
  const todo = pickNew(pool.picked, done, remaining, idOf, (ad) => typeof ad.metrics.euTotalSpend === "number" ? ad.metrics.euTotalSpend : 0);
  summary.candidates = todo.map((ad) => ({ adId: idOf(ad), brand: ad.brandDomain || ad.brandName, startedAt: ad.startedAt }));
  if (input.dryRun) return finish("Dry run — no ads submitted");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, async () => {
    while (cursor < todo.length && Date.now() - started < budgetMs - (research ? 380_000 : 0)) {
      const ad = todo[cursor++]!;
      const now = new Date();
      try {
        // Write only ads that will start. This mapper never changes corpus membership.
        const row = toCompetitorAdRow(ad, now.toISOString(), new Date(now.getTime() + BRANDSEARCH_MEDIA_TTL_MS).toISOString());
        const write = await supabase.from("CompetitorAd").upsert(row, { onConflict: "provider,platform,externalId", ignoreDuplicates: false });
        if (write.error) throw new Error(write.error.message);
        if (research) {
          const reservation = await supabase.rpc("reserve_brandsearch_budget", { ad_id: row.id, budget_scope: "daily_research", cap });
          if (reservation.error) throw new Error(reservation.error.message);
          if (reservation.data) summary.results.push(await researchAd(row.id));
        } else summary.results.push(await deconstructAd(row.id));
      } catch (error) {
        summary.results.push({ adId: idOf(ad), outcome: "failed", detail: error instanceof Error ? error.message : String(error), costUsd: null });
      }
    }
  }));
  return finish(cursor < todo.length ? "Time budget reached" : "Complete");
}

/** Research outcomes deliberately never mutate AdTeardown status. */
export async function researchAd(adId: string): Promise<StepResult> {
  try {
    const ad = await loadAd(adId);
    const result = await importAdResearch(ad);
    if (ad.corpusIncluded && result.snapshot) await importResearchTranscript(ad, result.snapshot);
    return { adId, outcome: result.status === "ready" ? "done" : result.status === "processing" ? "processing" : "queued",
      detail: result.snapshot ? `Speech: ${result.snapshot.transcript.status} · AI context: ${result.snapshot.analysis.status} · visuals unassessed${result.status === "deferred" ? " · deferred retry" : ""}` : "Research in progress",
      costUsd: 0, creditsUsed: result.creditsUsed, researchSnapshotId: result.snapshot?.id };
  } catch (error) { return { adId, outcome: "failed", detail: String(error), costUsd: 0 }; }
}
