"use client";

import { useState, useTransition } from "react";
import { createBigSwing, deleteBigSwing } from "../actions/big-swings";

interface SwingLite {
  id: string;
  slug: string;
  name: string;
  funnel: string;
  description: string;
  visualSpec: string;
  headlines: string[];
}

type FunnelOpt = "TOFU" | "MOFU" | "BOFU";

const EMPTY = {
  name: "",
  slug: "",
  funnel: "MOFU" as FunnelOpt,
  description: "",
  visualSpec: "",
  headlineOptionsRaw: "",
};

export function BigSwingsClient({ swings }: { swings: SwingLite[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  const reset = () => { setForm(EMPTY); setError(null); };

  const submit = () => {
    setError(null);
    const headlines = form.headlineOptionsRaw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    startSave(async () => {
      try {
        await createBigSwing({
          name: form.name,
          slug: form.slug || undefined,
          funnel: form.funnel,
          description: form.description,
          visualSpec: form.visualSpec,
          headlineOptions: headlines,
          hookMechanic: null,
        });
        setOpen(false);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (s: SwingLite) => {
    if (!confirm(`Delete "${s.name}"? Runs using this format will keep a stale reference.`)) return;
    startDelete(async () => {
      try { await deleteBigSwing(s.id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Formats ({swings.length})</h2>
        {open ? (
          <button className="btn" onClick={() => { setOpen(false); reset(); }}>Cancel</button>
        ) : (
          <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New format</button>
        )}
      </div>

      {open && (
        <div className="card mt-3 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Add a Big-Swing format</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Defines a new visual format the wizard&apos;s Big-Swing lane can pick. The engine has
              no built-in spec for custom formats, so prompts will rely on your description and
              visual spec verbatim — make them concrete.
            </p>
          </div>
          <div className="grid-fields">
            <div className="sm:col-span-2">
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Polaroid Strip" />
            </div>
            <div>
              <label className="label">Slug (optional)</label>
              <input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="polaroid-strip (auto from name)" />
            </div>
            <div>
              <label className="label">Funnel fit</label>
              <select className="input" value={form.funnel} onChange={(e) => setForm({ ...form, funnel: e.target.value as FunnelOpt })}>
                <option>TOFU</option><option>MOFU</option><option>BOFU</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One-sentence summary of the format." />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Visual spec</label>
              <textarea className="input min-h-[80px]" value={form.visualSpec} onChange={(e) => setForm({ ...form, visualSpec: e.target.value })} placeholder="Composition rules, what to include / avoid. Be concrete." />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Default headline options (one per line)</label>
              <textarea className="input min-h-[80px]" value={form.headlineOptionsRaw} onChange={(e) => setForm({ ...form, headlineOptionsRaw: e.target.value })} placeholder={"Before the day even ends.\nOne swap, one shift."} />
            </div>
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={isSaving || !form.name || !form.description || !form.visualSpec}
            >
              {isSaving ? "Saving…" : "Save format"}
            </button>
            <button className="btn" onClick={() => { setOpen(false); reset(); }} disabled={isSaving}>Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {swings.map((s) => (
          <div key={s.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{s.name}</h3>
              <div className="flex items-center gap-2">
                <span className="tag">{s.funnel}</span>
                <button
                  className="btn btn-ghost text-xs text-red-700 hover:bg-red-50"
                  onClick={() => remove(s)}
                  disabled={isDeleting}
                >
                  delete
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-ink-500">{s.description}</p>
            <p className="mt-2 text-xs"><span className="label">Visual spec</span>{s.visualSpec}</p>
            {s.headlines.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.headlines.map((h) => <span key={h} className="tag">{h}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
