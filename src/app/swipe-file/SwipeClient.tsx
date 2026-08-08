"use client";

import { useState, useTransition } from "react";
import { createSwipeFile, deleteSwipeFile } from "../actions/swipe-knowledge";

interface Item {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  notes: string | null;
  imagePath: string | null;
  sourceUrl: string | null;
  tags: string | null;
  createdAt: string;
}

const CATEGORIES = ["hook", "layout", "typography", "claim", "other"];

export function SwipeClient({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", brand: "", category: "hook", notes: "", imagePath: "", sourceUrl: "", tags: "",
  });

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await createSwipeFile({
          title: form.title,
          brand: form.brand || null,
          category: form.category || null,
          notes: form.notes || null,
          imagePath: form.imagePath || null,
          sourceUrl: form.sourceUrl || null,
          tags: form.tags ? JSON.stringify(form.tags.split(",").map((t) => t.trim()).filter(Boolean)) : null,
        });
        setOpen(false);
        setForm({ title: "", brand: "", category: "hook", notes: "", imagePath: "", sourceUrl: "", tags: "" });
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this swipe file entry?")) return;
    startTransition(async () => {
      try { await deleteSwipeFile(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Swipe file</h1>
          <p className="text-sm text-ink-500">Things that caught your eye. Reference, not copy-paste fodder.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add entry"}</button>
      </header>

      {open && (
        <div className="card space-y-3">
          <div className="grid-fields">
            <div>
              <label className="label">Title</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label">Brand</label>
              <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tags (comma-separated)</label>
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Source URL</label>
              <input className="input" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={isPending || !form.title} onClick={submit}>{isPending ? "Saving…" : "Save"}</button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card text-sm text-ink-500">No entries yet.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            let tags: string[] = [];
            try { tags = it.tags ? JSON.parse(it.tags) as string[] : []; } catch { /* */ }
            return (
              <li key={it.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{it.title}</div>
                    {(it.brand || it.category) && (
                      <div className="text-xs text-ink-500">
                        {[it.brand, it.category].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-ghost text-xs text-red-700" onClick={() => remove(it.id)}>delete</button>
                </div>
                {it.notes && <p className="mt-2 text-sm">{it.notes}</p>}
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.map((t) => <span key={t} className="tag">{t}</span>)}
                  </div>
                )}
                {it.sourceUrl && (
                  <a href={it.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-ink-500 underline">
                    source ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
