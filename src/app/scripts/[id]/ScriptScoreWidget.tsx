"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ScoreRun = {
  id: string;
  scriptVersion: number;
  status: string;
  marketCode: string;
  errorSummary: string | null;
  createdAt: string;
};

type ScoreModule = {
  module: string;
  status: string;
  score: number | null;
  label: string;
  summary: string;
};

export type ScriptScoreWidgetResult = {
  run: ScoreRun;
  modules: ScoreModule[];
};

type MarketOption = { code: string; name: string };

const MODULES = [
  { key: "structural_fit", label: "Structure" },
  { key: "verbatim_grounding", label: "Grounding" },
  { key: "specificity", label: "Specificity" },
  { key: "fact_verification", label: "Facts" },
] as const;

function moduleValue(scoreModule: ScoreModule | undefined): string {
  if (!scoreModule) return "Not run";
  if (scoreModule.status === "not_configured") return "Not configured";
  if (scoreModule.status === "insufficient_evidence") return "Needs evidence";
  if (scoreModule.status === "failed") return "Failed";
  return scoreModule.score == null ? "Diagnostic" : `${Math.round(scoreModule.score)}`;
}

function scoreTone(score: number | null): string {
  if (score == null) return "bg-ink-300";
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

export function ScriptScoreWidget({
  projectId,
  version,
  hasImmutableVersion,
  draftMatchesVersion,
  markets,
  initialResult,
  setupError,
}: {
  projectId: string;
  version: number;
  hasImmutableVersion: boolean;
  draftMatchesVersion: boolean;
  markets: MarketOption[];
  initialResult: ScriptScoreWidgetResult | null;
  setupError: string | null;
}) {
  const [result, setResult] = useState<ScriptScoreWidgetResult | null>(initialResult);
  const [marketCode, setMarketCode] = useState(initialResult?.run.marketCode ?? markets[0]?.code ?? "PH");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(setupError);

  useEffect(() => {
    if (initialResult?.run.scriptVersion === version) {
      setResult(initialResult);
      setMarketCode(initialResult.run.marketCode);
    } else {
      setResult(null);
    }
    setError(setupError);
  }, [initialResult, setupError, version]);

  const runScorer = async () => {
    if (!hasImmutableVersion || pending) return;
    setPending(true);
    setError(null);
    try {
      const createResponse = await fetch("/api/scorer/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scriptVersion: version, marketCode }),
      });
      const created = await createResponse.json() as { runId?: string; error?: string };
      if (!createResponse.ok || !created.runId) {
        throw new Error(created.error || "The scorer did not return a run ID.");
      }

      const resultResponse = await fetch(`/api/scorer/runs/${encodeURIComponent(created.runId)}`);
      const nextResult = await resultResponse.json() as ScriptScoreWidgetResult & { error?: string };
      if (!resultResponse.ok || !nextResult.run) {
        throw new Error(nextResult.error || "The score result could not be loaded.");
      }
      setResult(nextResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const moduleByKey = new Map(result?.modules.map((module) => [module.module, module]) ?? []);
  const reportHref = result ? `/scorer/${result.run.id}` : `/scorer?project=${encodeURIComponent(projectId)}&version=${version}`;

  return (
    <aside aria-label="Script score" className="order-first lg:order-none lg:sticky lg:top-40">
      <section className="max-h-[calc(100dvh-11rem)] overflow-y-auto rounded-2xl border border-ink-200/80 bg-white shadow-pop">
        <div className="bg-ink-900 px-4 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold tracking-tight">Script scorer</h2>
              <p className="mt-0.5 text-xs text-white/65">Immutable version {version}</p>
            </div>
            <span className="rounded-full border border-brand-pink/50 bg-brand-pink/15 px-2 py-0.5 text-[11px] font-medium text-brand-blush">Experimental</span>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {!hasImmutableVersion && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Create an immutable version before scoring this script.
            </div>
          )}

          {hasImmutableVersion && !draftMatchesVersion && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="font-semibold">Draft changed since v{version}</div>
              <p className="mt-1 text-amber-800">These results cover the saved version, not the edits currently on screen.</p>
            </div>
          )}

          {result?.run.status === "complete" ? (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-ink-500">Results for v{result.run.scriptVersion} · {result.run.marketCode}</p>
              {MODULES.map((item) => {
                const scoreModule = moduleByKey.get(item.key);
                const numericScore = scoreModule?.status === "scored" ? scoreModule.score : null;
                return (
                  <div key={item.key} title={scoreModule?.summary}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink-600">{item.label}</span>
                      <span className={`text-right font-semibold ${numericScore == null ? "text-xs text-ink-500" : "text-ink-900"}`}>{moduleValue(scoreModule)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                      <div className={`h-full rounded-full ${scoreTone(numericScore)}`} style={{ width: `${numericScore ?? 0}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="border-t border-ink-200 pt-3 text-[11px] leading-4 text-ink-500">Modules stay separate until the scorer is calibrated. There is no overall score.</p>
            </div>
          ) : result?.run.status === "failed" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <div className="font-semibold">Scoring failed</div>
              <p className="mt-1 line-clamp-4 text-red-800">{result.run.errorSummary ?? "The run ended without a result."}</p>
            </div>
          ) : result ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">The scorer is still processing v{version}.</div>
          ) : (
            <div className="py-1 text-sm text-ink-500">
              <p>No score exists for version {version} yet.</p>
              <p className="mt-1 text-xs">Run the four evidence-linked checks without leaving the script.</p>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}

          <div className="space-y-2 border-t border-ink-200 pt-4">
            <label htmlFor="script-score-market" className="block text-xs font-medium text-ink-600">Scoring market</label>
            <select id="script-score-market" className="input h-9 py-1 text-xs" value={marketCode} disabled={pending || !hasImmutableVersion} onChange={(event) => setMarketCode(event.target.value)}>
              {markets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.name}</option>)}
            </select>
            <button type="button" className="btn btn-primary w-full" disabled={pending || !hasImmutableVersion} onClick={runScorer}>
              {pending ? "Scoring version…" : result?.run.status === "complete" && result.run.marketCode === marketCode ? "Refresh result" : `Score v${version} · ${marketCode}`}
            </button>
            <Link href={reportHref} className="flex min-h-9 items-center justify-center rounded-full text-xs font-semibold text-ink-700 hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900">
              {result ? "Open full report" : "Open scorer setup"}
            </Link>
          </div>
        </div>
      </section>
    </aside>
  );
}
