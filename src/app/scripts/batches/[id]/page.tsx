import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStrategist } from "@/lib/authorization";
import { parseScriptDocument } from "@/lib/cellumove/script-studio";
import type { ScriptProjectRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

type BatchResult = { frameworkId: string; frameworkName: string; projectId: string | null; error: string | null };

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
  return <div className="space-y-6">
    <header><Link href="/scripts" className="text-sm text-ink-500 hover:underline">← Script Studio</Link><h1 className="mt-2 text-2xl font-semibold">Framework comparison</h1><p className="mt-1 text-sm text-ink-500">One idea, compared across {results.length} selected frameworks. Each draft remains independently editable.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      {results.map((result) => {
        const project = result.projectId ? projects.get(result.projectId) : null;
        if (!project) return <article key={result.frameworkId} className="card border-red-200 bg-red-50"><h2 className="font-semibold">{result.frameworkName}</h2><p className="mt-2 text-sm text-red-700">{result.error || "This draft was not created."}</p></article>;
        const document = parseScriptDocument(project.document);
        const seconds = document.modules.reduce((sum, module) => sum + module.durationSec, 0);
        return <article key={result.frameworkId} className="card flex flex-col"><div className="flex items-start justify-between gap-3"><div><span className="tag">{result.frameworkName}</span><h2 className="mt-2 font-semibold">{project.title}</h2></div><span className="text-xs text-ink-500">{document.modules.length} beats · {seconds}s</span></div>{document.fiveD && <dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-ink-400">Avatar</dt><dd>{document.fiveD.avatar}</dd></div><div><dt className="text-ink-400">Angle</dt><dd>{document.fiveD.angle}</dd></div><div><dt className="text-ink-400">Identity</dt><dd>{document.fiveD.identityLevel}</dd></div><div><dt className="text-ink-400">Dynamism</dt><dd>{document.fiveD.dynamismLevel}</dd></div></dl>}<div className="mt-4 border-t border-ink-200 pt-3"><p className="line-clamp-3 text-sm">{document.hookAlternatives[0]?.text ?? document.modules[0]?.spokenText}</p></div><Link href={`/scripts/${project.id}`} className="btn btn-primary mt-4">Open this draft →</Link></article>;
      })}
    </div>
  </div>;
}

