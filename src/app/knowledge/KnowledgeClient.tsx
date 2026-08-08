"use client";

import { useState, useTransition } from "react";
import { deleteKnowledgeNote, upsertKnowledgeNote } from "../actions/swipe-knowledge";

interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tags: string | null;
  updatedAt: string;
}

export function KnowledgeClient({ notes }: { notes: Note[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", title: "", body: "", pinned: false, tags: "" });

  const start = (n?: Note) => {
    if (n) {
      let tagsStr = "";
      try { const arr = n.tags ? JSON.parse(n.tags) : []; tagsStr = Array.isArray(arr) ? arr.join(", ") : ""; } catch { /* */ }
      setForm({ id: n.id, title: n.title, body: n.body, pinned: n.pinned, tags: tagsStr });
      setEditingId(n.id);
    } else {
      setForm({ id: "", title: "", body: "", pinned: false, tags: "" });
      setEditingId(null);
    }
    setOpen(true);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await upsertKnowledgeNote({
          id: form.id || undefined,
          title: form.title,
          body: form.body,
          pinned: form.pinned,
          tags: form.tags ? JSON.stringify(form.tags.split(",").map((t) => t.trim()).filter(Boolean)) : null,
        });
        setOpen(false);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this note?")) return;
    startTransition(async () => {
      try { await deleteKnowledgeNote(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Notes</h2>
        <button className="btn btn-primary" onClick={() => start()}>+ New note</button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Body</label>
            <textarea className="input min-h-[140px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Tags (comma-separated)</label>
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <label className="flex items-end gap-2 text-sm">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
              Pin this note
            </label>
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={isPending || !form.title || !form.body} onClick={submit}>
              {isPending ? "Saving…" : editingId ? "Update" : "Create"}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="card text-sm text-ink-500">No notes yet.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((n) => {
            let tags: string[] = [];
            try { tags = n.tags ? JSON.parse(n.tags) : []; } catch { /* */ }
            return (
              <li key={n.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      {n.pinned && <span className="tag tag-warn">pinned</span>}
                      <h3 className="text-sm font-semibold">{n.title}</h3>
                    </div>
                    <div className="text-xs text-ink-500">updated {new Date(n.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost text-xs" onClick={() => start(n)}>edit</button>
                    <button className="btn btn-ghost text-xs text-red-700" onClick={() => remove(n.id)}>delete</button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.map((t) => <span key={t} className="tag">{t}</span>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
