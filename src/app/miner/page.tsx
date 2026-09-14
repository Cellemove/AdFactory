import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { requireUser } from "@/lib/authorization";
import { isBrandSearchConfigured, listSpectreCompetitors } from "@/lib/brandsearch.server";
import { brandSummaries, findBrandSummary } from "@/lib/cellumove/corpus/brand-progress";
import { CORPUS_TAXONOMY_VERSION } from "@/lib/cellumove/corpus/constants";
import { latestGate1 } from "@/lib/cellumove/corpus/eval.server";
import { latestBrandReport } from "@/lib/cellumove/corpus/mine.server";
import { latestBrandPlaybook } from "@/lib/cellumove/corpus/playbook.server";
import { planTeardown, selectStageRows } from "@/lib/cellumove/corpus/queue";
import { loadCorpusState } from "@/lib/cellumove/corpus/state.server";
import { loadAdTeardowns } from "@/lib/cellumove/corpus/teardown.server";
import { WINNER_DEFAULT_TARGET } from "@/lib/cellumove/corpus/winners";
import type { AdTeardownRow } from "@/lib/database.types";
import { MinerTabs } from "./MinerTabs";
import { RunClient } from "./_run/RunClient";
import type { RunSnapshot } from "./_run/types";

export const metadata: Metadata = { title: "Run pipeline · Corpus Miner · AdFactory" };
export const dynamic = "force-dynamic";

const MEDIA_FAILED = new Set(["failed", "oversize", "unavailable", "expired", "not_video"]);

export default async function MinerRunPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  await requireUser();
  const [user, query] = await Promise.all([getSessionUser(), searchParams]);

  let snapshot: RunSnapshot;
  try {
    const [state, teardowns, competitors, gate] = await Promise.all([
      loadCorpusState(),
      loadAdTeardowns().catch((): AdTeardownRow[] => []),
      // Spectre is a network call; a blip must not take the whole page down.
      isBrandSearchConfigured()
        ? listSpectreCompetitors().catch((error: unknown) => {
          console.error("[miner] Spectre competitor list failed:", error);
          return null;
        })
        : Promise.resolve(null),
      latestGate1(),
    ]);

    const rows = state.rows;
    const brands = brandSummaries(rows, competitors ?? [], teardowns);
    const brand = findBrandSummary(brands, query.brand ?? null);
    const scope = { brand: brand?.domain ?? undefined };
    const ofBrand = brand ? rows.filter((row) => row.brandName.toLowerCase() === brand.domain.toLowerCase()) : [];
    const count = (predicate: (row: (typeof ofBrand)[number]) => boolean) =>
      ofBrand.filter((row) => row.mediaType === "video" && row.corpusIncluded && predicate(row)).length;
    const plan = planTeardown(rows, teardowns, scope);
    const teardownByAd = new Map(teardowns.map((row) => [row.competitorAdId, row]));
    const [mined, playbook] = brand
      ? await Promise.all([latestBrandReport(brand.domain).catch(() => null), latestBrandPlaybook(brand.domain).catch(() => null)])
      : [null, null];

    snapshot = {
      brand,
      brands,
      competitorsUnavailable: competitors === null,
      gate: {
        passed: Boolean(gate?.passed),
        summary: gate
          ? `Last check ${gate.passed ? "passed" : "failed"}: ${Math.round((gate.layerAgreement ?? 0) * 100)}% layer / ${Math.round((gate.codeAgreement ?? 0) * 100)}% code agreement on ${gate.goldAdCount} hand-labelled ads.`
          : `The extractor has never been checked against hand-labelled ads (taxonomy ${CORPUS_TAXONOMY_VERSION} is still a placeholder).`,
      },
      stages: {
        ingest: { ready: 0, done: brand?.inCorpus ?? 0, failed: 0, total: brand?.inCorpus ?? 0 },
        media: { ready: selectStageRows("media", rows, scope).length, done: brand?.downloaded ?? 0, failed: count((row) => MEDIA_FAILED.has(row.mediaStatus ?? "")), total: brand?.inCorpus ?? 0 },
        transcribe: { ready: selectStageRows("transcribe", rows, scope).length, done: brand?.transcribed ?? 0, failed: count((row) => row.transcriptStatus === "failed"), total: brand?.inCorpus ?? 0 },
        extract: { ready: selectStageRows("extract", rows, scope).length, done: brand?.extracted ?? 0, failed: count((row) => row.extractStatus === "failed"), total: brand?.inCorpus ?? 0, review: brand?.needsReview ?? 0 },
        score: { ready: (brand?.inCorpus ?? 0) - (brand?.ranked ?? 0), done: brand?.ranked ?? 0, failed: 0, total: brand?.inCorpus ?? 0 },
        mine: { ready: Math.max(0, (brand?.extracted ?? 0) - (mined?.row.adCount ?? 0)), done: mined?.row.adCount ?? 0, failed: 0, total: brand?.extracted ?? 0, lastRunAt: mined?.row.createdAt ?? null },
        playbook: { ready: Math.max(0, (brand?.extracted ?? 0) - (playbook?.row.adCount ?? 0)), done: playbook?.row.adCount ?? 0, failed: 0, total: brand?.extracted ?? 0, lastRunAt: playbook?.row.createdAt ?? null },
        teardown: {
          ready: plan.todo.length,
          done: plan.winners.filter((row) => teardownByAd.get(row.id)?.status === "completed").length,
          failed: plan.winners.filter((row) => teardownByAd.get(row.id)?.status === "failed").length,
          total: plan.winners.length,
        },
      },
      pendingTeardowns: plan.pending.map((row) => ({ id: row.id, brandName: row.brandName, winnerScore: row.winnerScore })),
      lastMined: mined ? { at: mined.row.createdAt, adCount: mined.row.adCount } : null,
      lastPlaybook: playbook ? { at: playbook.row.createdAt, adCount: playbook.row.adCount } : null,
      defaultTarget: WINNER_DEFAULT_TARGET,
    };
  } catch (error) {
    return (
      <div className="space-y-6">
        <MinerTabs active="run" />
        <div className="card border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-amber-900">Database setup required</h2>
          <p className="mt-2 text-sm text-amber-800">Apply <code>migrations/017_corpus_miner.sql</code> through <code>023_corpus_visuals_and_playbook.sql</code>, then reload this page.</p>
          <p className="mt-2 text-xs text-amber-700">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      </div>
    );
  }

  return <RunClient snapshot={snapshot} canRun={user?.role === "creative_strategist"} />;
}
