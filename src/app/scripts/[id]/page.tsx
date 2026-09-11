import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStrategist } from "@/lib/authorization";
import { parseScriptDocument } from "@/lib/cellumove/script-studio";
import { normalizeScriptWorkflowStatus, SCRIPT_STATUS_META } from "@/lib/cellumove/script-workflow";
import type { MarketProfileRow, ScriptAssignmentRow, ScriptProjectRow, ScriptScoreModuleRow, ScriptScoreRunRow, ScriptVersionRow } from "@/lib/database.types";
import { supabase, unwrapOpt } from "@/lib/db";
import { ScriptStudioClient } from "./ScriptStudioClient";
import { AssignEditorControl } from "../AssignEditorControl";

export const metadata: Metadata = { title: "Script Editor · AdFactory" };
export const dynamic = "force-dynamic";

export default async function ScriptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStrategist();
  const { id } = await params;
  const [projectRaw, versionsRes, sourcesRes, strategistRes, editorRes, marketsRes] = await Promise.all([
    unwrapOpt(await supabase.from("ScriptProject").select("*").eq("id", id).maybeSingle()),
    supabase.from("ScriptVersion").select("*").eq("projectId", id).order("version", { ascending: false }),
    supabase.from("ScriptSource").select("*").eq("projectId", id).order("createdAt", { ascending: true }),
    supabase.from("AppUser").select("*").then((result) => result),
    supabase.from("ScriptAssignment").select("*").eq("projectId", id).maybeSingle(),
    supabase.from("MarketProfile").select("*").order("code"),
  ]);
  const project = projectRaw as ScriptProjectRow | null;
  if (!project) notFound();

  const users = strategistRes.data ?? [];
  const strategist = users.find((user) => user.id === project.strategistUserId);
  const editor = users.find((user) => user.id === project.editorUserId);
  const editors = users.filter((user) => user.role === "editor").map((user) => ({ id: user.id, username: user.username }));
  const document = parseScriptDocument(project.document);
  const assignment = editorRes.data as ScriptAssignmentRow | null;
  const workflowStatus = normalizeScriptWorkflowStatus(project.status, assignment?.status);
  const statusMeta = SCRIPT_STATUS_META[workflowStatus];
  const handoffVersion = (versionsRes.data ?? []).find((version) => version.origin === "assigned")?.version ?? null;
  const versions = (versionsRes.data ?? []) as ScriptVersionRow[];
  const namedVersion = versions.find((item) => item.version === project.currentVersion) ?? null;
  const namedVersionDocument = namedVersion ? parseScriptDocument(namedVersion.document) : null;
  const markets = (marketsRes.data ?? []) as MarketProfileRow[];
  const scorerMarkets = markets.length ? markets.map((market) => ({ code: market.code.toUpperCase(), name: market.name })) : [{ code: "PH", name: "Philippines" }, { code: "US", name: "United States" }];

  const latestScoreRes = await supabase.from("ScriptScoreRun").select("*").eq("projectId", project.id).eq("scriptVersion", project.currentVersion).order("createdAt", { ascending: false }).limit(1).maybeSingle();
  const latestScore = latestScoreRes.data as ScriptScoreRunRow | null;
  const scoreModulesRes = latestScore
    ? await supabase.from("ScriptScoreModule").select("*").eq("runId", latestScore.id)
    : null;
  const scorerSetupError = latestScoreRes.error?.message ?? scoreModulesRes?.error?.message ?? marketsRes.error?.message ?? null;
  const initialScore = latestScore && !scoreModulesRes?.error
    ? { run: latestScore, modules: (scoreModulesRes?.data ?? []) as ScriptScoreModuleRow[] }
    : null;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/scripts" className="text-sm text-ink-500 hover:text-ink-900">← Script Studio</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1><span className={statusMeta.className}>{statusMeta.label}</span></div>
            <p className="mt-1 break-all font-mono text-xs text-ink-500">{project.displayName}</p>
          </div>
          <div className="space-y-2 text-right text-xs text-ink-500"><div>Owner: @{strategist?.username ?? "unknown"}</div>{editor ? <div>Video editor: @{editor.username}</div> : <div className="space-y-1"><div>Video editor: Unassigned</div><AssignEditorControl projectId={project.id} editors={editors} /></div>}<div>Version {project.currentVersion} · revision {project.revision}</div><Link href={`/scorer?project=${encodeURIComponent(project.id)}&version=${project.currentVersion}`} className="btn">Score this version</Link></div>
        </div>
      </header>

      <ScriptStudioClient projectId={project.id} initialDocument={document} initialRevision={project.revision} initialVersion={project.currentVersion} initialNamedVersionDocument={namedVersionDocument} initialHandoffVersion={handoffVersion} initialStatus={workflowStatus} editorName={editor?.username ?? null} scorerMarkets={scorerMarkets} initialScore={initialScore} scorerSetupError={scorerSetupError} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card"><h2 className="font-semibold">Sources</h2><div className="divider" />{(sourcesRes.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No imported sources.</p> : <ul className="space-y-2 text-sm">{(sourcesRes.data ?? []).map((source) => <li key={source.id}><span className="tag mr-2">{source.sourceType}</span>{source.url ? <a className="hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}</li>)}</ul>}</section>
        <section className="card"><h2 className="font-semibold">Version history</h2><div className="divider" /><ul className="space-y-2 text-sm">{(versionsRes.data ?? []).map((version) => <li key={version.id} className="flex justify-between gap-3"><span>v{version.version} · {version.changeSummary}</span><span className="whitespace-nowrap text-xs text-ink-500">{new Date(version.createdAt).toLocaleString()}</span></li>)}</ul></section>
      </div>

      {editorRes.error && <p className="text-xs text-red-700">Assignment data could not be loaded: {editorRes.error.message}</p>}
    </div>
  );
}
