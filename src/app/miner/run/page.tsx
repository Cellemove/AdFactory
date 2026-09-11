import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { requireUser } from "@/lib/authorization";
import { CORPUS_TAXONOMY_VERSION } from "@/lib/cellumove/corpus/constants";
import { latestGate1 } from "@/lib/cellumove/corpus/eval.server";
import { latestReports } from "@/lib/cellumove/corpus/mine.server";
import { planTeardown, selectStageRows } from "@/lib/cellumove/corpus/queue";
import { loadCorpusState } from "@/lib/cellumove/corpus/state.server";
import { loadAdTeardowns } from "@/lib/cellumove/corpus/teardown.server";
import type { AdTeardownRow } from "@/lib/database.types";
import { MinerTabs } from "../MinerTabs";
import { RunClient, type RunSnapshot } from "./RunClient";

export const metadata: Metadata = { title: "Run pipeline · Corpus Miner · AdFactory" };
export const dynamic = "force-dynamic";

const MEDIA_FAILED = new Set(["failed", "oversize", "unavailable", "expired", "not_video"]);

export default async function MinerRunPage() {
  await requireUser();
  const user = await getSessionUser();

  let snapshot: RunSnapshot;
  try {
    const [state, teardowns, gate, reports] = await Promise.all([
      loadCorpusState(),
      loadAdTeardowns().catch((): AdTeardownRow[] => []),
      latestGate1(),
      latestReports(),
    ]);
    const rows = state.rows;
    const videos = rows.filter((row) => row.mediaType === "video" && row.corpusIncluded);
    const count = (predicate: (row: (typeof videos)[number]) => boolean) => videos.filter(predicate).length;
    const plan = planTeardown(rows, teardowns);
    const teardownByAd = new Map(teardowns.map((row) => [row.competitorAdId, row]));
    const extracted = count((row) => row.extractStatus === "complete" || row.extractStatus === "reviewed");
    const all = reports.find((item) => item.row.cohort === "all") ?? null;
    const undownloaded = videos.filter((row) => row.mediaStatus !== "downloaded" && row.hasVideoUrl && row.mediaExpiresAt);
    const expiries = undownloaded.map((row) => Date.parse(row.mediaExpiresAt!)).filter(Number.isFinite);

    snapshot = {
      totalAds: rows.length,
      videos: videos.length,
      brands: new Set(videos.map((row) => row.brandName)).size,
      linksExpireAt: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null,
      undownloaded: undownloaded.length,
      gate: {
        passed: Boolean(gate?.passed),
        summary: gate
          ? `Last check ${gate.passed ? "passed" : "failed"}: ${Math.round((gate.layerAgreement ?? 0) * 100)}% layer / ${Math.round((gate.codeAgreement ?? 0) * 100)}% code agreement on ${gate.goldAdCount} hand-labelled ads.`
          : `Not run yet — needs the 35 hand-labelled ads and the full beat list (taxonomy ${CORPUS_TAXONOMY_VERSION} is a placeholder).`,
      },
      stages: {
        ingest: { ready: 0, done: videos.length, failed: 0, total: videos.length },
        media: { ready: selectStageRows("media", rows).length, done: count((row) => row.mediaStatus === "downloaded"), failed: count((row) => MEDIA_FAILED.has(row.mediaStatus ?? "")), total: videos.length },
        transcribe: { ready: selectStageRows("transcribe", rows).length, done: count((row) => row.transcriptStatus === "complete"), failed: count((row) => row.transcriptStatus === "failed"), total: videos.length },
        extract: { ready: selectStageRows("extract", rows).length, done: extracted, failed: count((row) => row.extractStatus === "failed"), total: videos.length, review: count((row) => row.extractStatus === "needs_human_review") },
        score: { ready: rows.filter((row) => row.winnerScore == null).length, done: rows.filter((row) => row.winnerScore != null).length, failed: 0, total: rows.length },
        mine: { ready: Math.max(0, extracted - (all?.row.adCount ?? 0)), done: all?.row.adCount ?? 0, failed: 0, total: extracted, lastRunAt: all?.row.createdAt ?? null },
        teardown: {
          ready: plan.todo.length,
          done: plan.winners.filter((row) => teardownByAd.get(row.id)?.status === "completed").length,
          failed: plan.winners.filter((row) => teardownByAd.get(row.id)?.status === "failed").length,
          total: plan.winners.length,
        },
      },
      pendingTeardowns: plan.pending.map((row) => ({ id: row.id, brandName: row.brandName, winnerScore: row.winnerScore })),
    };
  } catch (error) {
    return (
      <div className="space-y-6">
        <MinerTabs active="run" />
        <div className="card border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-amber-900">Database setup required</h2>
          <p className="mt-2 text-sm text-amber-800">Apply <code>migrations/017_corpus_miner.sql</code> through <code>020_corpus_winner_pick.sql</code>, then reload this page.</p>
          <p className="mt-2 text-xs text-amber-700">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      </div>
    );
  }

  return <RunClient snapshot={snapshot} canRun={user?.role === "creative_strategist"} />;
}
