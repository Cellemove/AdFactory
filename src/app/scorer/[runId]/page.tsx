import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStrategist } from "@/lib/authorization";
import { scriptSourceLines } from "@/lib/cellumove/script-scorer";
import { getScriptScoreRun } from "@/lib/cellumove/script-scorer.server";
import type { ScriptScoreFindingRow, ScriptScoreModuleRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Score Result · AdFactory" };
export const dynamic = "force-dynamic";

const MODULE_ORDER = ["structural_fit", "verbatim_grounding", "specificity", "fact_verification"] as const;

function moduleTone(module: ScriptScoreModuleRow): string {
  if (module.status !== "scored") return "border-amber-200 bg-amber-50/60";
  if (module.score == null) return "border-ink-200";
  if (module.score >= 75) return "border-emerald-200 bg-emerald-50/50";
  if (module.score >= 50) return "border-amber-200 bg-amber-50/50";
  return "border-red-200 bg-red-50/50";
}

function statusLabel(module: ScriptScoreModuleRow): string {
  if (module.status === "not_configured") return "Not configured";
  if (module.status === "insufficient_evidence") return "Insufficient evidence";
  if (module.status === "failed") return "Failed";
  return module.score == null ? "Diagnostic only" : `${Math.round(module.score)} / 100`;
}

function evidenceHref(finding: ScriptScoreFindingRow): string | null {
  if (!finding.evidenceId) return null;
  if (finding.evidenceType === "verbatim") return `/verbatims?highlight=${encodeURIComponent(finding.evidenceId)}`;
  if (finding.evidenceType === "brand_fact" || finding.evidenceType === "product_offer") return `/products?evidence=${encodeURIComponent(finding.evidenceId)}`;
  if (finding.evidenceType === "gold_ad" || finding.evidenceType === "gold_beat") return `/winners?evidence=${encodeURIComponent(finding.evidenceId)}`;
  return null;
}

function Findings({ findings }: { findings: ScriptScoreFindingRow[] }) {
  if (!findings.length) return <p className="text-sm text-ink-500">No findings for this module.</p>;
  return (
    <ul className="space-y-3">
      {findings.map((finding) => {
        const href = finding.scriptModuleId != null && finding.lineIndex != null ? `#line-${finding.scriptModuleId}-${finding.lineIndex}` : null;
        const sourceHref = evidenceHref(finding);
        return (
          <li key={finding.id} className={`rounded-xl border p-3 ${finding.severity === "critical" ? "border-red-200 bg-red-50" : finding.severity === "warning" ? "border-amber-200 bg-amber-50/70" : "border-ink-200 bg-ink-50"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><span className={finding.severity === "critical" ? "tag tag-danger" : finding.severity === "warning" ? "tag tag-warn" : "tag"}>{finding.severity}</span>{href && <a className="text-xs font-medium text-ink-600 hover:underline" href={href}>Show script line ↓</a>}</div>
            {finding.scriptQuote && <blockquote className="mt-2 border-l-2 border-ink-300 pl-3 text-sm font-medium">“{finding.scriptQuote}”</blockquote>}
            <p className="mt-2 text-sm">{finding.message}</p>
            {finding.recommendation && <p className="mt-1 text-xs text-ink-600">Recommendation: {finding.recommendation}</p>}
            {finding.evidenceQuote && <div className="mt-3 rounded-lg border border-ink-200 bg-white p-2 text-xs text-ink-600"><div className="mb-1 font-medium uppercase tracking-wide text-ink-400">Closest evidence{finding.similarity != null ? ` · ${Math.round(finding.similarity * 100)}%` : ""}</div>“{finding.evidenceQuote}”{sourceHref && <Link href={sourceHref} className="ml-2 font-medium text-ink-900 hover:underline">Open source →</Link>}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export default async function ScoreResultPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireStrategist();
  const { runId } = await params;
  const result = await getScriptScoreRun(runId);
  if (!result) notFound();
  const context = result.run.contextSnapshot && typeof result.run.contextSnapshot === "object" && !Array.isArray(result.run.contextSnapshot)
    ? result.run.contextSnapshot as Record<string, unknown>
    : {};
  const product = context.product && typeof context.product === "object" && !Array.isArray(context.product) ? context.product as Record<string, unknown> : {};
  const angle = context.angle && typeof context.angle === "object" && !Array.isArray(context.angle) ? context.angle as Record<string, unknown> : {};
  const avatar = context.avatar && typeof context.avatar === "object" && !Array.isArray(context.avatar) ? context.avatar as Record<string, unknown> : null;
  const moduleByKey = new Map(result.modules.map((module) => [module.module, module]));
  const primaryModules = MODULE_ORDER.flatMap((key) => moduleByKey.get(key) ? [moduleByKey.get(key)!] : []);
  const observer = moduleByKey.get("observer_flags") ?? null;
  const sourceLines = scriptSourceLines(result.scriptSnapshot);
  const findingsByModule = new Map<string, ScriptScoreFindingRow[]>();
  result.findings.forEach((finding) => findingsByModule.set(finding.module, [...(findingsByModule.get(finding.module) ?? []), finding]));

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href="/scorer" className="text-sm text-ink-500 hover:text-ink-900">← Script Scorer</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{result.scriptSnapshot.title}</h1><span className="tag tag-warn">Experimental</span><span className={result.run.status === "complete" ? "tag tag-ok" : result.run.status === "failed" ? "tag tag-danger" : "tag tag-warn"}>{result.run.status}</span></div><p className="mt-1 text-sm text-ink-500">Version {result.run.scriptVersion} · {String(product.name ?? result.scriptSnapshot.product.name)} · {String(angle.name ?? result.scriptSnapshot.angle.name)} · {avatar ? String(avatar.name ?? "Avatar") : "No sub-avatar"} · {result.run.marketCode}</p></div>
          <div className="text-right text-xs text-ink-500"><div>{result.run.engineVersion}</div><div>{result.run.taxonomyVersion} · {result.run.baselineVersion}</div></div>
        </div>
      </header>

      {result.run.status === "failed" && <section className="card border-red-200 bg-red-50"><h2 className="font-semibold text-red-900">Scoring failed</h2><p className="mt-2 text-sm text-red-800">{result.run.errorSummary ?? "The run ended without a result."}</p><p className="mt-2 text-xs text-red-700">{result.run.errorCode}</p></section>}
      {result.run.status !== "failed" && result.run.status !== "complete" && <section className="card border-amber-200 bg-amber-50"><h2 className="font-semibold text-amber-900">Scoring is still running</h2><p className="mt-2 text-sm text-amber-800">Reload this page after the extraction request finishes.</p></section>}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {primaryModules.map((module) => <article key={module.module} className={`rounded-2xl border p-4 shadow-card ${moduleTone(module)}`}><div className="text-xs font-medium uppercase tracking-wide text-ink-500">{module.label}</div><div className="mt-3 text-2xl font-semibold">{statusLabel(module)}</div><p className="mt-2 text-xs text-ink-600">{module.summary}</p></article>)}
        {!primaryModules.length && result.run.status === "complete" && <div className="card md:col-span-2 xl:col-span-4"><p className="text-sm text-ink-500">This completed run contains no module results.</p></div>}
      </section>

      {primaryModules.map((module) => <section key={module.module} className="card"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{module.label}</h2><span className={module.status === "scored" ? "tag tag-ok" : module.status === "failed" ? "tag tag-danger" : "tag tag-warn"}>{statusLabel(module)}</span></div><p className="mt-1 text-sm text-ink-500">{module.summary}</p><div className="divider" /><Findings findings={findingsByModule.get(module.module) ?? []} /></section>)}

      {observer && <details className="card"><summary className="cursor-pointer list-none font-semibold"><span className="mr-2">Observer-only flags</span><span className="tag">{(findingsByModule.get(observer.module) ?? []).length}</span></summary><p className="mt-2 text-sm text-ink-500">These flags are diagnostic and do not affect another score.</p><div className="divider" /><Findings findings={findingsByModule.get(observer.module) ?? []} /></details>}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Scored script snapshot</h2><span className="tag">Immutable v{result.run.scriptVersion}</span></div>
        <p className="mt-1 text-xs text-ink-500">Finding links point to the exact frozen line below.</p>
        <div className="divider" />
        <div className="space-y-5">
          {result.scriptSnapshot.modules.map((scriptModule) => {
            const lines = sourceLines.filter((line) => line.scriptModuleId === scriptModule.id);
            return <article key={scriptModule.id}><div className="mb-2 flex items-center gap-2"><span className="tag">{scriptModule.kind}</span><h3 className="text-sm font-semibold">{scriptModule.label}</h3><span className="text-xs text-ink-400">{scriptModule.durationSec}s</span></div><ol className="space-y-1">{lines.map((line) => <li id={`line-${line.scriptModuleId}-${line.lineIndex}`} key={`${line.scriptModuleId}-${line.lineIndex}`} className="scroll-mt-28 rounded-lg border border-transparent px-3 py-2 text-sm target:border-amber-300 target:bg-amber-50">{line.text}</li>)}</ol></article>;
          })}
        </div>
      </section>
    </div>
  );
}
