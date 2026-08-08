"use client";

import { useRef, useState, useTransition } from "react";
import { createWinningAd, deleteWinningAd, extractWinnerFromImage, updateWinningAd } from "../actions/winners";
import { addPerformanceEntry, deletePerformanceEntry } from "../actions/performance";

interface AngleLite { slug: string; name: string }
interface KpiLite {
  id: string;
  date: string;
  spend: number;
  roas: number | null;
  ctr: number | null;
  cpa: number | null;
  purchases: number;
  impressions: number;
  notes: string | null;
}
interface WinnerLite {
  id: string;
  adName: string;
  funnel: string;
  adType: string;
  headline: string;
  visualConcept: string;
  hookType: string | null;
  angleName: string;
  angleSlug: string;
  notes: string | null;
  imagePath: string | null;
  createdAt: string;
  kpiSummary: string | null;
  kpis: KpiLite[];
}

type Mode = "upload" | "review" | "manual";
type AdType = "static" | "video";

const EMPTY_FIELDS = {
  adName: "",
  funnel: "MOFU",
  adType: "static" as AdType,
  headline: "",
  visualConcept: "",
  hookType: "",
  notes: "",
  imagePath: "",
};

export function WinnersClient({ angles, winners }: { angles: AngleLite[]; winners: WinnerLite[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    angleSlug: angles[0]?.slug ?? "",
    ...EMPTY_FIELDS,
  });

  const resetAll = () => {
    setForm((f) => ({ angleSlug: f.angleSlug, ...EMPTY_FIELDS }));
    setMode("upload");
    setEditingId(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startEdit = (w: WinnerLite) => {
    setForm({
      angleSlug: w.angleSlug,
      adName: w.adName,
      funnel: w.funnel,
      adType: (w.adType === "video" ? "video" : "static") as AdType,
      headline: w.headline,
      visualConcept: w.visualConcept,
      hookType: w.hookType ?? "",
      notes: w.notes ?? "",
      imagePath: w.imagePath ?? "",
    });
    setEditingId(w.id);
    setMode("manual"); // skip the upload step — edit goes straight to the form
    setOpen(true);
    setError(null);
    // Scroll to the form so the user sees it open above the list
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  };

  const onExtract = async (file: File) => {
    setError(null);
    setIsExtracting(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const result = await extractWinnerFromImage(fd);
      setForm((f) => ({
        ...f,
        imagePath: result.imagePath,
        adName: result.adName || f.adName,
        funnel: result.funnel || f.funnel,
        adType: result.adType || f.adType,
        headline: result.headline || f.headline,
        visualConcept: result.visualConcept || f.visualConcept,
        hookType: result.hookType || f.hookType,
      }));
      setMode("review");
    } catch (e) {
      // In production, Next.js scrubs server-action error messages and attaches
      // a `digest` you can grep for in Vercel logs. Show it so the user can find
      // the real cause without paging through the log stream.
      const msg = e instanceof Error ? e.message : String(e);
      const digest = (e as { digest?: string } | undefined)?.digest;
      setError(digest ? `${msg} (Vercel log digest: ${digest})` : msg);
    } finally {
      setIsExtracting(false);
    }
  };

  const submit = () => {
    setError(null);
    startSaveTransition(async () => {
      try {
        if (editingId) {
          await updateWinningAd({
            id: editingId,
            angleSlug: form.angleSlug,
            adName: form.adName,
            funnel: form.funnel as "TOFU" | "MOFU" | "BOFU",
            adType: form.adType,
            headline: form.headline,
            visualConcept: form.visualConcept,
            hookType: form.hookType || null,
            imagePath: form.imagePath || null,
            notes: form.notes || null,
          });
        } else {
          await createWinningAd({
            angleSlug: form.angleSlug,
            adName: form.adName,
            funnel: form.funnel as "TOFU" | "MOFU" | "BOFU",
            adType: form.adType,
            headline: form.headline,
            visualConcept: form.visualConcept,
            hookType: form.hookType || null,
            imagePath: form.imagePath || null,
            notes: form.notes || null,
          });
        }
        setOpen(false);
        resetAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this winner? Iterations linked to it will lose their parent reference.")) return;
    startSaveTransition(async () => {
      try { await deleteWinningAd(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void onExtract(f);
  };

  const openWith = (adType: AdType) => {
    if (open) {
      // If form is already open, allow swapping types in-place.
      setForm((f) => ({ ...f, adType }));
      return;
    }
    setForm((f) => ({ ...f, adType }));
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Winning ads</h1>
          <p className="text-sm text-ink-500">Source of truth for the Iteration lane. Only iterate from winners.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open ? (
            <button className="btn" onClick={() => { setOpen(false); resetAll(); }}>
              Close
            </button>
          ) : (
            <>
              <button
                className={`btn ${form.adType === "static" ? "btn-primary" : ""}`}
                onClick={() => openWith("static")}
              >
                + Add Static Winner
              </button>
              <button
                className={`btn ${form.adType === "video" ? "btn-primary" : ""}`}
                onClick={() => openWith("video")}
              >
                + Add Video Winner
              </button>
            </>
          )}
        </div>
      </header>

      {open && (
        <div className="card space-y-4">
          {/* ─── UPLOAD MODE ──────────────────────────────────────────────── */}
          {mode === "upload" && (
            <>
              <div>
                <h2 className="text-sm font-semibold">Add a winning ad</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  Drop a screenshot of the ad. Gemini reads the headline + visual and fills in the fields for you to review.
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  onFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-12 text-center transition ${
                  isDragging ? "border-ink-900 bg-ink-100" : "border-ink-300 bg-ink-50 hover:border-ink-900"
                } ${isExtracting ? "pointer-events-none opacity-60" : ""}`}
              >
                {isExtracting ? (
                  <>
                    <div className="text-sm font-medium text-ink-900">Reading image with Gemini…</div>
                    <div className="text-xs text-ink-500">Usually 10–20 seconds</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-ink-900">Click to upload or drag an image here</div>
                    <div className="text-xs text-ink-500">PNG, JPEG, WEBP, GIF · up to 8MB</div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={isExtracting}
                  onChange={(e) => onFiles(e.target.files)}
                />
              </div>

              {error && <div className="text-sm text-red-700">{error}</div>}

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-ink-500 underline hover:text-ink-900"
                  onClick={() => setMode("manual")}
                  disabled={isExtracting}
                >
                  No image? Add manually instead
                </button>
                <button className="btn" onClick={() => { setOpen(false); resetAll(); }} disabled={isExtracting}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* ─── REVIEW or MANUAL ──────────────────────────────────────────── */}
          {(mode === "review" || mode === "manual") && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {editingId
                      ? "Edit winner"
                      : mode === "review"
                        ? "Review extracted fields"
                        : "Add winner manually"}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {editingId
                      ? "Update any field. Image cannot be changed here — delete + re-add to swap it."
                      : mode === "review"
                        ? "Gemini pre-filled what it read from the image. Edit any field before saving."
                        : "Fill the fields below. You can also drop an image to extract them automatically."}
                  </p>
                </div>
                {mode === "review" && !editingId && (
                  <button
                    type="button"
                    className="text-xs text-ink-500 underline hover:text-ink-900"
                    onClick={resetAll}
                  >
                    Replace image
                  </button>
                )}
                {mode === "manual" && (
                  <button
                    type="button"
                    className="text-xs text-ink-500 underline hover:text-ink-900"
                    onClick={() => setMode("upload")}
                  >
                    Upload an image instead
                  </button>
                )}
              </div>

              {form.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imagePath} alt="uploaded ad" className="max-h-64 w-auto rounded border border-ink-200" />
              )}

              <div>
                <label className="label">Ad type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, adType: "static" })}
                    className={`rounded-md border p-3 text-left transition ${form.adType === "static" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
                  >
                    <div className="text-sm font-semibold">Static</div>
                    <div className={`text-xs ${form.adType === "static" ? "text-ink-200" : "text-ink-500"}`}>Still image ad.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, adType: "video" })}
                    className={`rounded-md border p-3 text-left transition ${form.adType === "video" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
                  >
                    <div className="text-sm font-semibold">Video</div>
                    <div className={`text-xs ${form.adType === "video" ? "text-ink-200" : "text-ink-500"}`}>Video/Reel/TikTok ad.</div>
                  </button>
                </div>
              </div>

              <div className="grid-fields">
                <div>
                  <label className="label">Angle</label>
                  <select className="input" value={form.angleSlug} onChange={(e) => setForm({ ...form, angleSlug: e.target.value })}>
                    {angles.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Funnel</label>
                  <select className="input" value={form.funnel} onChange={(e) => setForm({ ...form, funnel: e.target.value })}>
                    <option>TOFU</option><option>MOFU</option><option>BOFU</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Ad name (canonical)</label>
                  <input className="input" value={form.adName} onChange={(e) => setForm({ ...form, adName: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Headline (verbatim)</label>
                  <input className="input" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Visual concept</label>
                  <textarea className="input min-h-[80px]" value={form.visualConcept} onChange={(e) => setForm({ ...form, visualConcept: e.target.value })} />
                </div>
                <div>
                  <label className="label">Hook type (optional)</label>
                  <input className="input" value={form.hookType} onChange={(e) => setForm({ ...form, hookType: e.target.value })} />
                </div>
                <div>
                  <label className="label">Notes</label>
                  <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              {error && <div className="text-sm text-red-700">{error}</div>}
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={isSaving || !form.adName || !form.headline || !form.visualConcept}
                >
                  {isSaving ? "Saving…" : editingId ? "Save changes" : "Save winner"}
                </button>
                <button className="btn" onClick={() => { setOpen(false); resetAll(); }} disabled={isSaving}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {winners.length === 0 ? (
        <div className="card">
          <p className="text-sm text-ink-500">No winners yet. Add one to enable the Iterate lane.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {winners.map((w) => (
            <li key={w.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  {w.imagePath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.imagePath} alt={w.adName} className="h-20 w-auto rounded border border-ink-200" />
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{w.adName}</span>
                      <span className={`tag ${w.adType === "video" ? "tag-warn" : "tag-ok"}`}>
                        {w.adType === "video" ? "video" : "static"}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500">
                      {w.angleName} · {w.funnel}{w.hookType ? ` · ${w.hookType}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => startEdit(w)}
                  >
                    edit
                  </button>
                  <button
                    className="btn btn-ghost text-xs text-red-700 hover:bg-red-50"
                    onClick={() => remove(w.id)}
                  >
                    delete
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm"><span className="text-xs uppercase tracking-wide text-ink-500">Headline · </span>{w.headline}</p>
              <p className="mt-1 text-sm text-ink-700"><span className="text-xs uppercase tracking-wide text-ink-500">Visual · </span>{w.visualConcept}</p>
              <WinnerKpis winner={w} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Per-winner KPI panel — the "input data we put (KPI of the ads)" that feeds
// the Iterate lane's prompt. Add reports, see the blended summary, delete rows.
const KPI_EMPTY = { date: "", spend: "", impressions: "", clicks: "", purchases: "", roas: "", notes: "" };

function WinnerKpis({ winner }: { winner: WinnerLite }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...KPI_EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const set = (k: keyof typeof KPI_EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const add = () => {
    setError(null);
    if (!form.spend.trim()) { setError("Enter at least spend."); return; }
    startTransition(async () => {
      try {
        await addPerformanceEntry({
          winnerId: winner.id,
          adName: winner.adName,
          spend: Number(form.spend),
          impressions: form.impressions ? Number(form.impressions) : undefined,
          clicks: form.clicks ? Number(form.clicks) : undefined,
          purchases: form.purchases ? Number(form.purchases) : undefined,
          roas: form.roas ? Number(form.roas) : undefined,
          date: form.date || undefined,
          notes: form.notes || undefined,
        });
        setForm({ ...KPI_EMPTY });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      try { await deletePerformanceEntry(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="mt-3 border-t border-ink-100 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">KPIs · </span>
          {winner.kpiSummary ? (
            <span className="text-ink-700">{winner.kpiSummary}</span>
          ) : (
            <span className="text-ink-400">none yet — add the ad&apos;s real numbers to guide iterations</span>
          )}
        </div>
        <button className="btn btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? "close" : "＋ KPIs"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {winner.kpis.length > 0 && (
            <ul className="space-y-1">
              {winner.kpis.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2 rounded border border-ink-100 bg-ink-50/50 px-2 py-1 text-xs">
                  <span className="text-ink-600">
                    {new Date(k.date).toLocaleDateString()} · ${Math.round(k.spend).toLocaleString()}
                    {k.roas != null ? ` · ROAS ${k.roas}` : ""}
                    {k.ctr != null ? ` · CTR ${k.ctr}%` : ""}
                    {k.purchases ? ` · ${k.purchases} purch` : ""}
                    {k.notes ? ` · ${k.notes}` : ""}
                  </span>
                  <button className="text-red-600 hover:underline" onClick={() => remove(k.id)} disabled={busy}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-[11px] text-ink-500">
              Date
              <input type="date" className="input mt-0.5 h-8 py-0 text-xs" value={form.date} onChange={(e) => set("date", e.target.value)} disabled={busy} />
            </label>
            <label className="text-[11px] text-ink-500">
              Spend ($)
              <input type="number" min="0" step="0.01" className="input mt-0.5 h-8 py-0 text-xs" value={form.spend} onChange={(e) => set("spend", e.target.value)} disabled={busy} />
            </label>
            <label className="text-[11px] text-ink-500">
              ROAS
              <input type="number" min="0" step="0.01" className="input mt-0.5 h-8 py-0 text-xs" value={form.roas} onChange={(e) => set("roas", e.target.value)} disabled={busy} />
            </label>
            <label className="text-[11px] text-ink-500">
              Purchases
              <input type="number" min="0" className="input mt-0.5 h-8 py-0 text-xs" value={form.purchases} onChange={(e) => set("purchases", e.target.value)} disabled={busy} />
            </label>
            <label className="text-[11px] text-ink-500">
              Impressions
              <input type="number" min="0" className="input mt-0.5 h-8 py-0 text-xs" value={form.impressions} onChange={(e) => set("impressions", e.target.value)} disabled={busy} />
            </label>
            <label className="text-[11px] text-ink-500">
              Clicks
              <input type="number" min="0" className="input mt-0.5 h-8 py-0 text-xs" value={form.clicks} onChange={(e) => set("clicks", e.target.value)} disabled={busy} />
            </label>
            <label className="col-span-2 text-[11px] text-ink-500">
              Notes
              <input className="input mt-0.5 h-8 py-0 text-xs" placeholder="e.g. last 7d, Meta" value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={busy} />
            </label>
          </div>
          {error && <div className="text-xs text-red-700">{error}</div>}
          <button className="btn btn-primary text-xs" onClick={add} disabled={busy || !form.spend.trim()}>
            {busy ? "Saving…" : "Add KPI report"}
          </button>
          <p className="text-[11px] text-ink-400">
            CTR &amp; CPA are auto-computed when you enter impressions/clicks/purchases. These feed the Iterate lane so Gemini preserves what&apos;s working.
          </p>
        </div>
      )}
    </div>
  );
}
