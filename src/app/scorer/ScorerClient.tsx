"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ProjectOption = {
  id: string;
  title: string;
  displayName: string;
  format: string;
  productName: string;
  angleName: string;
  avatarName: string | null;
};

type VersionOption = {
  id: string;
  projectId: string;
  version: number;
  changeSummary: string;
  createdAt: string;
};

type MarketOption = { code: string; name: string };
type RecentRun = { id: string; projectId: string; scriptVersion: number; marketCode: string; status: string; createdAt: string };

export function ScorerClient({
  projects,
  versions,
  markets,
  recentRuns,
  initialProjectId,
  initialVersion,
}: {
  projects: ProjectOption[];
  versions: VersionOption[];
  markets: MarketOption[];
  recentRuns: RecentRun[];
  initialProjectId: string | null;
  initialVersion: number | null;
}) {
  const router = useRouter();
  const firstProject = projects.find((project) => project.id === initialProjectId)?.id ?? projects[0]?.id ?? "";
  const [projectId, setProjectId] = useState(firstProject);
  const projectVersions = useMemo(() => versions.filter((version) => version.projectId === projectId), [projectId, versions]);
  const initialVersionExists = projectVersions.some((version) => version.version === initialVersion);
  const [scriptVersion, setScriptVersion] = useState(initialVersionExists ? String(initialVersion) : String(projectVersions[0]?.version ?? ""));
  const [marketCode, setMarketCode] = useState(markets[0]?.code ?? "PH");
  const [force, setForce] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const chooseProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    const newest = versions.find((version) => version.projectId === nextProjectId);
    setScriptVersion(String(newest?.version ?? ""));
    setError(null);
  };

  const run = async () => {
    if (!projectId || !scriptVersion || !marketCode) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/scorer/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scriptVersion: Number(scriptVersion), marketCode, force }),
      });
      const payload = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) throw new Error(payload.error || "The scorer did not return a run ID.");
      router.push(`/scorer/${payload.runId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="grid gap-4 lg:grid-cols-3">
          <label>
            <span className="label">Script project</span>
            <select className="input" value={projectId} onChange={(event) => chooseProject(event.target.value)} disabled={pending}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Immutable version</span>
            <select className="input" value={scriptVersion} onChange={(event) => setScriptVersion(event.target.value)} disabled={pending || !projectVersions.length}>
              {projectVersions.map((version) => <option key={version.id} value={version.version}>v{version.version} · {version.changeSummary}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Market</span>
            <select className="input" value={marketCode} onChange={(event) => setMarketCode(event.target.value)} disabled={pending}>
              {markets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.name}</option>)}
            </select>
          </label>
        </div>

        {selectedProject && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="tag">{selectedProject.productName}</span>
            <span className="tag">{selectedProject.angleName}</span>
            <span className="tag">{selectedProject.avatarName ?? "No sub-avatar"}</span>
            <span className="tag">{selectedProject.format}</span>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-4">
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} disabled={pending} />
            Run again even if an identical result exists
          </label>
          <button className="btn btn-primary" type="button" onClick={run} disabled={pending || !projectId || !scriptVersion}>
            {pending ? "Extracting and scoring…" : "Run scorer"}
          </button>
        </div>
        {pending && <p className="mt-3 text-sm text-ink-500">Gemini Flash is extracting fixed script lines. This page will open the result when all deterministic modules finish.</p>}
        {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </section>

      <section className="card">
        <h2 className="font-semibold">Recent score runs</h2>
        <div className="divider" />
        {recentRuns.length ? (
          <ul className="divide-y divide-ink-200 text-sm">
            {recentRuns.map((run) => {
              const project = projects.find((candidate) => candidate.id === run.projectId);
              return (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div><span className="font-medium">{project?.title ?? "Unknown script"}</span><span className="ml-2 text-ink-500">v{run.scriptVersion} · {run.marketCode}</span></div>
                  <div className="flex items-center gap-3"><span className={run.status === "complete" ? "tag tag-ok" : run.status === "failed" ? "tag tag-danger" : "tag tag-warn"}>{run.status}</span><Link className="text-sm font-medium hover:underline" href={`/scorer/${run.id}`}>View →</Link></div>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-ink-500">No score runs yet.</p>}
      </section>
    </div>
  );
}

