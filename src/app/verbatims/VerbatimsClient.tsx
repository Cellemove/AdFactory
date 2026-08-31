"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mineVerbatims, deleteVerbatim } from "../actions/verbatims";
import type { VerbatimRow } from "@/lib/database.types";

interface Cat { slug: string; label: string; description: string }

export function VerbatimsClient({
  angles, subs, markets, categories, sourceTypes, verbatims,
  filterAngle, filterCat, page, pageCount, total, angleTotal, countByCat,
}: {
  angles: Array<{ id: string; name: string; slug: string }>;
  subs: Array<{ id: string; name: string; angleName: string }>;
  markets: Array<{ code: string; name: string }>;
  categories: Cat[];
  sourceTypes: Array<{ slug: string; label: string }>;
  verbatims: VerbatimRow[];
  filterAngle: string;
  filterCat: string;
  page: number;
  pageCount: number;
  total: number;
  angleTotal: number;
  countByCat: Record<string, number>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigating, startNav] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mining form
  const [angleSlug, setAngleSlug] = useState("");
  const [subAvatarId, setSubAvatarId] = useState("");
  const [focus, setFocus] = useState("");
  const [market, setMarket] = useState("");
  const [count, setCount] = useState("24");

  // Browser filters live in the URL — the database applies them, so they cover
  // the whole corpus (not just loaded rows) and survive refresh.
  const navigate = (next: { angle?: string; cat?: string; page?: number }) => {
    const p = new URLSearchParams();
    const nAngle = next.angle ?? filterAngle;
    const nCat = next.cat ?? filterCat;
    const nPage = next.page ?? 1; // filter changes reset to page 1
    if (nAngle) p.set("angle", nAngle);
    if (nCat) p.set("cat", nCat);
    if (nPage > 1) p.set("page", String(nPage));
    startNav(() => router.push(`/verbatims${p.size ? `?${p}` : ""}`));
  };

  const catLabel = useMemo(() => new Map(categories.map((c) => [c.slug, c.label])), [categories]);

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
          targetCount: count ? Number(count) : undefined,
        });
        setNotice(
          `Mined ${res.count} new verbatim${res.count === 1 ? "" : "s"}` +
            (res.duplicatesSkipped
              ? ` · skipped ${res.duplicatesSkipped} duplicate${res.duplicatesSkipped === 1 ? "" : "s"}`
              : "") +
            (res.rejectedByQuality
              ? ` · rejected ${res.rejectedByQuality} weak or off-topic comment${res.rejectedByQuality === 1 ? "" : "s"}`
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

  const canMine = (angleSlug || subAvatarId) && !isPending;

  return (
    <div className="space-y-6">
      {/* Mining form */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold">Mine verified verbatims</h2>
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
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Verification source: {sourceTypes.find((s) => s.slug === "youtube_comment")?.label ?? "YouTube comment"} via the YouTube Data API.
          Quotes are copied directly from the API and linked to the exact comment. AI-generated and paraphrased quotes are rejected.
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={!canMine} onClick={mine}>
            {isPending ? "Mining…" : "Mine verified verbatims"}
          </button>
          {notice && <span className="text-sm text-emerald-700">{notice}</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
        <p className="text-xs text-ink-400">Direct source collection — typically 10–30s. Pick an angle or a sub-avatar to enable.</p>
      </div>

      {/* Corpus browser */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Verified corpus</h2>
          <span className="text-xs text-ink-500">
            {total} match{total === 1 ? "" : "es"}
            {pageCount > 1 ? ` · page ${page}/${pageCount}` : ""}
          </span>
          <div className="ml-auto flex gap-2">
            <select
              className="input h-8 py-0 text-xs"
              value={filterAngle}
              onChange={(e) => navigate({ angle: e.target.value, page: 1 })}
            >
              <option value="">All angles</option>
              {angles.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
            </select>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => navigate({ cat: "", page: 1 })}
            className={`rounded-md px-2 py-0.5 text-xs transition ${filterCat === "" ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`}
          >
            All ({angleTotal})
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              onClick={() => navigate({ cat: c.slug === filterCat ? "" : c.slug, page: 1 })}
              title={c.description}
              className={`rounded-md px-2 py-0.5 text-xs transition ${filterCat === c.slug ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`}
            >
              {c.label} ({countByCat[c.slug] ?? 0})
            </button>
          ))}
        </div>

        {verbatims.length === 0 ? (
          <div className="card text-sm text-ink-500">No verbatims yet for this filter. Mine some above.</div>
        ) : (
          <ul className={`space-y-2 ${navigating ? "opacity-60 transition-opacity" : ""}`}>
            {verbatims.map((v) => (
              <li key={v.id} className="card flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm">“{v.text}”</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    <span className="tag">{catLabel.get(v.category) ?? v.category}</span>
                    <span className="tag">{v.sourceType}</span>
                    <span className="tag border-emerald-200 bg-emerald-50 text-emerald-700">✓ verified</span>
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

        {pageCount > 1 && (
          <nav className="flex items-center justify-center gap-3 pt-2 text-sm">
            <button
              className="btn h-8 text-xs"
              onClick={() => navigate({ page: page - 1 })}
              disabled={page <= 1 || navigating}
            >
              ← Prev
            </button>
            <span className="text-xs text-ink-500">
              Page <span className="font-semibold text-ink-900">{page}</span> of {pageCount}
            </span>
            <button
              className="btn h-8 text-xs"
              onClick={() => navigate({ page: page + 1 })}
              disabled={page >= pageCount || navigating}
            >
              Next →
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
