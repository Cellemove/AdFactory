"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishScriptPlaybook, retireScriptPlaybookDraft, saveScriptPlaybookDraft } from "@/app/actions/script-playbooks";

export type PlaybookManagerRow = {
  id: string;
  version: string;
  title: string;
  status: string;
  promptInstructions: string;
  config: unknown;
  sourceHash: string;
  publishedAt: string | null;
  updatedAt: string;
};

const EMPTY = { id: "", title: "", promptInstructions: "", config: "{}", sourceStatus: "new" };

export function ScriptPlaybookManager({ playbooks, setupError }: { playbooks: PlaybookManagerRow[]; setupError: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<typeof EMPTY | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(setupError);

  const edit = (row?: PlaybookManagerRow) => {
    setError(null);
    setEditing(row ? {
      id: row.id,
      title: row.title,
      promptInstructions: row.promptInstructions,
      config: JSON.stringify(row.config, null, 2),
      sourceStatus: row.status,
    } : EMPTY);
  };

  const save = () => {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      try {
        await saveScriptPlaybookDraft({ id: editing.id || undefined, title: editing.title, promptInstructions: editing.promptInstructions, config: editing.config });
        setEditing(null);
        router.refresh();
      } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    });
  };

  const publish = (id: string) => {
    if (!confirm("Publish this playbook? The currently published version will be retired, while existing scripts keep their snapshot.")) return;
    startTransition(async () => {
      try { await publishScriptPlaybook(id); router.refresh(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    });
  };

  const retire = (id: string) => {
    if (!confirm("Retire this draft? It remains in history but cannot be selected for generation.")) return;
    startTransition(async () => {
      try { await retireScriptPlaybookDraft(id); router.refresh(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    });
  };

  return <section className="card space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><h2 className="font-semibold">Script Studio playbook</h2><span className="tag">Versioned</span></div><p className="mt-1 text-xs text-ink-500">Only the published version can generate new scripts. Editing a published or retired version creates a new draft.</p></div>
      <button type="button" className="btn btn-primary" disabled={pending || Boolean(setupError)} onClick={() => edit()}>+ New draft</button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {editing && <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{editing.sourceStatus === "draft" ? "Edit draft" : editing.sourceStatus === "new" ? "New draft" : "Create draft from snapshot"}</h3>{editing.sourceStatus !== "draft" && editing.sourceStatus !== "new" && <span className="text-xs text-amber-700">Original stays immutable</span>}</div>
      <div className="mt-3 space-y-3"><div><label className="label">Title</label><input className="input" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div><div><label className="label">Prompt instructions</label><textarea className="input min-h-48 font-mono text-xs leading-5" value={editing.promptInstructions} onChange={(event) => setEditing({ ...editing, promptInstructions: event.target.value })} /></div><div><label className="label">Structured rules (JSON)</label><textarea className="input min-h-64 font-mono text-xs leading-5" value={editing.config} onChange={(event) => setEditing({ ...editing, config: event.target.value })} /></div></div>
      <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn" disabled={pending} onClick={() => setEditing(null)}>Discard</button><button type="button" className="btn btn-primary" disabled={pending || editing.title.trim().length < 3 || editing.promptInstructions.trim().length < 40} onClick={save}>{pending ? "Saving…" : editing.sourceStatus === "draft" ? "Save draft" : "Create draft"}</button></div>
    </div>}
    <div className="divide-y divide-ink-200 border-y border-ink-200">{playbooks.map((row) => <article key={row.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{row.title}</h3><span className={`tag ${row.status === "published" ? "border-emerald-300 text-emerald-700" : row.status === "draft" ? "border-amber-300 text-amber-700" : ""}`}>{row.status}</span></div><p className="mt-1 text-xs text-ink-500">{row.version} · source {row.sourceHash.slice(0, 12)} · updated {new Date(row.updatedAt).toLocaleString()}</p></div>
      <div className="flex shrink-0 gap-2"><button type="button" className="btn btn-ghost" disabled={pending} onClick={() => edit(row)}>{row.status === "draft" ? "Edit" : "Create draft from"}</button>{row.status === "draft" && <><button type="button" className="btn btn-primary" disabled={pending} onClick={() => publish(row.id)}>Publish</button><button type="button" className="btn btn-ghost text-red-700" disabled={pending} onClick={() => retire(row.id)}>Retire</button></>}</div>
    </article>)}</div>
    {!playbooks.length && !setupError && <p className="text-sm text-ink-500">No playbook versions exist yet.</p>}
  </section>;
}
