import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStrategist } from "@/lib/authorization";
import { bestHook, parseScriptDocument } from "@/lib/cellumove/script-studio";
import { normalizeScriptWorkflowStatus, SCRIPT_STATUS_META } from "@/lib/cellumove/script-workflow";
import type { ScriptProjectRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { BatchActions } from "./BatchActions";

export const dynamic = "force-dynamic";

// Legacy rows carry frameworkId/frameworkName; new rows carry variantId/variantLabel.
type BatchResult = {
  variantId?: string;
  variantLabel?: string;
  frameworkId?: string;
  frameworkName?: string;
  projectId: string | null;
  error: string | null;
};

export default async function ScriptBatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStrategist();
  const { id } = await params;
  const batch = await supabase.from("Research").select("*").eq("id", id).eq("type", "script_batch").maybeSingle();
  if (!batch.data) notFound();
  let results: BatchResult[] = [];
  try { results = JSON.parse(batch.data.drafts).results ?? []; } catch { notFound(); }
  const ids = results.flatMap((result) => result.projectId ? [result.projectId] : []);
  const projectsResult = ids.length ? await supabase.from("ScriptProject").select("*").in("id", ids) : { data: [] };
  const projects = new Map(((projectsResult.data ?? []) as ScriptProjectRow[]).map((project) => [project.id, project]));

  // The cherry-pick ordering: cards with a top-ranked hook first, by that
  // hook's score. Rank hooks inside a draft (or here after opening) to sort.
  const cards = results.map((result) => {
    const key = result.variantId ?? result.frameworkId ?? result.projectId ?? "?";
    const label = result.variantLabel ?? result.frameworkName ?? "Variant";
    const project = result.projectId ? projects.get(result.projectId) ?? null : null;
    const document = project ? parseScriptDocument(project.document) : null;
    const hook = document ? bestHook(document) : null;
    return { key, label, result, project, document, hook, score: hook?.score ?? null };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const kept = cards.filter((card) => card.project && normalizeScriptWorkflowStatus(card.project.status) !== "archived");
  const discarded = cards.filter((card) => card.project && normalizeScriptWorkflowStatus(card.project.status) === "archived");
  const failed = cards.filter((card) => !card.project);

  return <div className="space-y-6">
    <header>
      <Link href="/scripts" className="text-sm text-ink-500 hover:underline">← Script Studio</Link>
      <h1 className="mt-2 text-2xl font-semibold">Variant comparison</h1>
      <p className="mt-1 text-sm text-ink-500">
        One idea, {results.length} variants. Cherry-pick: <strong>Send to editor</strong> keeps a draft (it enters the normal review flow), <strong>Discard</strong> archives it. Rank hooks inside a draft to sort this page by hook score.
      </p>
    </header>
    <div className="grid gap-4 lg:grid-cols-2">
      {kept.map(({ key, label, project, document, hook }) => {
        if (!project || !document) return null;
        const seconds = document.modules.reduce((sum, module) => sum + module.durationSec, 0);
        const status = normalizeScriptWorkflowStatus(project.status);
        const meta = SCRIPT_STATUS_META[status];
        return <article key={key} className="card flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div><span className="tag">{label}</span><h2 className="mt-2 font-semibold">{project.title}</h2></div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-ink-500">{document.modules.length} beats · {seconds}s</span>
              {typeof hook?.score === "number" && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hook.score >= 85 ? "bg-emerald-100 text-emerald-800" : hook.score >= 70 ? "bg-amber-100 text-amber-800" : "bg-ink-100 text-ink-600"}`} title={hook.scoreReason}>hook {hook.score}</span>}
              <span className={meta.className}>{meta.label}</span>
            </div>
          </div>
          <div className="mt-4 border-t border-ink-200 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Best hook</p>
            <p className="mt-1 line-clamp-3 text-sm">{hook?.text ?? document.modules[0]?.spokenText}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href={`/scripts/${project.id}`} className="btn btn-primary">Open this draft →</Link>
            <BatchActions projectId={project.id} status={status} />
          </div>
        </article>;
      })}
      {failed.map(({ key, label, result }) => (
        <article key={key} className="card border-red-200 bg-red-50"><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-red-700">{result.error || "This draft was not created."}</p></article>
      ))}
    </div>
    {discarded.length > 0 && (
      <section className="card">
        <h2 className="text-sm font-semibold text-ink-500">Discarded ({discarded.length})</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-500">
          {discarded.map(({ key, label, project }) => (
            <li key={key}>{label} · <Link className="underline" href={`/scripts/${project!.id}`}>{project!.title}</Link></li>
          ))}
        </ul>
      </section>
    )}
  </div>;
}
