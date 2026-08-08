"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mineVerbatims, deleteVerbatim } from "../actions/verbatims";
import type { VerbatimRow } from "@/lib/database.types";

interface Cat { slug: string; label: string; description: string }

export function VerbatimsClient({
  angles, subs, markets, categories, sourceTypes, verbatims,
}: {
  angles: Array<{ id: string; name: string; slug: string }>;
  subs: Array<{ id: string; name: string; angleName: string }>;
  markets: Array<{ code: string; name: string }>;
  categories: Cat[];
  sourceTypes: Array<{ slug: string; label: string }>;
  verbatims: VerbatimRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mining form
  const [angleSlug, setAngleSlug] = useState("");
  const [subAvatarId, setSubAvatarId] = useState("");
  const [focus, setFocus] = useState("");
  const [market, setMarket] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [count, setCount] = useState("24");

  // Browser filters
  const [filterAngle, setFilterAngle] = useState("");
  const [filterCat, setFilterCat] = useState("");

  const catLabel = useMemo(() => new Map(categories.map((c) => [c.slug, c.label])), [categories]);

  const togglePlatform = (slug: string) =>
    setPlatforms((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  const mine = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await mineVerbatims({
          angleSlug: angleSlug || null,
          subAvatarId: subAvatarId || null,
          focus: focus.trim() || null,
          market: market || null,
          platforms: platforms.length ? platforms : undefined,
          targetCount: count ? Number(count) : undefined,
        });
        setNotice(
          `Mined ${res.count} new verbatim${res.count === 1 ? "" : "s"}` +
            (res.duplicatesSkipped
              ? ` · skipped ${res.duplicatesSkipped} duplicate${res.duplicatesSkipped === 1 ? "" : "s"}`
              : "") +
            ".",
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      try { await deleteVerbatim(id); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const filtered = verbatims.filter((v) =>
    (!filterAngle || v.angleSlug === filterAngle) && (!filterCat || v.category === filterCat),
  );

  // Per-category counts (over the angle filter only, so the category chips stay useful).
  const angleScoped = verbatims.filter((v) => !filterAngle || v.angleSlug === filterAngle);
  const countByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of angleScoped) m.set(v.category, (m.get(v.category) ?? 0) + 1);
    return m;
  }, [angleScoped]);

  const canMine = (angleSlug || subAvatarId) && !isPending;

  return (
    <div className="space-y-6">
      {/* Mining form */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold">Mine new verbatims</h2>
        <div className="grid-fields">
          <div>
            <label className="label">Angle</label>
            <select className="input" value={angleSlug} onChange={(e) => { setAngleSlug(e.target.value); setSubAvatarId(""); }}>
              <option value="">Select an angle…</option>
              {angles.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">…or attach to a sub-avatar</label>
            <select className="input" value={subAvatarId} onChange={(e) => { setSubAvatarId(e.target.value); setAngleSlug(""); }}>
              <option value="">— none —</option>
              {subs.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.angleName}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Focus (desire / niche / product — optional)</label>
          <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. won't wear shorts in summer" />
        </div>
        <div className="grid-fields">
          <div>
            <label className="label">Market (optional)</label>
            <select className="input" value={market} onChange={(e) => setMarket(e.target.value)}>
              <option value="">— none —</option>
              {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Target count</label>
            <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Prioritize sources (optional)</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {sourceTypes.map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => togglePlatform(s.slug)}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  platforms.includes(s.slug) ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={!canMine} onClick={mine}>
            {isPending ? "Mining…" : "Mine verbatims"}
          </button>
          {notice && <span className="text-sm text-emerald-700">{notice}</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
        <p className="text-xs text-ink-400">Grounded web search — typically 20–60s. Pick an angle or a sub-avatar to enable.</p>
      </div>

      {/* Corpus browser */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Corpus</h2>
          <span className="text-xs text-ink-500">{filtered.length} shown · {verbatims.length} loaded</span>
          <div className="ml-auto flex gap-2">
            <select className="input h-8 py-0 text-xs" value={filterAngle} onChange={(e) => setFilterAngle(e.target.value)}>
              <option value="">All angles</option>
              {angles.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
            </select>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterCat("")}
            className={`rounded-md px-2 py-0.5 text-xs transition ${filterCat === "" ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`}
          >
            All ({angleScoped.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              onClick={() => setFilterCat(c.slug === filterCat ? "" : c.slug)}
              title={c.description}
              className={`rounded-md px-2 py-0.5 text-xs transition ${filterCat === c.slug ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`}
            >
              {c.label} ({countByCat.get(c.slug) ?? 0})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="card text-sm text-ink-500">No verbatims yet for this filter. Mine some above.</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((v) => (
              <li key={v.id} className="card flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm">“{v.text}”</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    <span className="tag">{catLabel.get(v.category) ?? v.category}</span>
                    <span className="tag">{v.sourceType}</span>
                    <span title="source weight">w {v.sourceWeight.toFixed(2)}</span>
                    <span title="engagement">· {v.engagementScore} eng</span>
                    {v.angleSlug && <span>· {v.angleSlug}</span>}
                    {v.sourceUrl && <a href={v.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-800">source</a>}
                  </div>
                </div>
                <button className="btn btn-ghost shrink-0 text-xs text-red-700" onClick={() => remove(v.id)}>delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
