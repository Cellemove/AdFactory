"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REFERENCE_MAX_BYTES, REFERENCE_STAGES, type ReferenceAnalysis, type ReferenceFramework, type ReferenceSource } from "@/lib/cellumove/reference-analysis";
import { uploadReferenceVideo } from "@/lib/cellumove/reference-upload";
import { ReferenceReports } from "./ReferenceReports";

export interface InlineFrameworkOption { id: string; name: string; duration: number | null; extracted: true; referenceAnalysisId?: string | null }
interface Props { onCreated: (framework: InlineFrameworkOption) => void; selectedAnalysisId?: string | null }
async function api<T>(path = "", body?: unknown): Promise<T> {
  const response = await fetch(`/api/reference-analyses${path}`, { cache: "no-store", method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed. Please try again.");
  return data as T;
}
export function InlineFrameworkExtractor({ onCreated, selectedAnalysisId }: Props) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReferenceSource["mode"]>("upload");
  const [url, setUrl] = useState(""); const [name, setName] = useState("");
  const [analysis, setAnalysis] = useState<ReferenceAnalysis | null>(null);
  const [recent, setRecent] = useState<ReferenceAnalysis[]>([]);
  const [draft, setDraft] = useState<ReferenceFramework | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const [playback, setPlayback] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const player = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDialogElement>(null); const draftFor = useRef<string | null>(null);
  const createId = useRef<string | null>(null); const activeId = useRef<string | null>(null);
  const seekTime = useRef(0);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const accept = useCallback((value: ReferenceAnalysis) => {
    activeId.current = value.id; setAnalysis(value); sessionStorage.setItem("reference-active-analysis", value.id);
    setRecent(rows => [value, ...rows.filter(r => r.id !== value.id)].slice(0, 30));
    if (value.result && draftFor.current !== value.id) { setDraft(value.approvedFramework ?? { ...value.result.framework, name: value.nameOverride || value.result.framework.name }); draftFor.current = value.id; }
  }, []);
  const load = useCallback(async (id: string) => {
    activeId.current = id; setError(null); setPlayback(null); setNotice(""); setDraft(null); draftFor.current = null;
    const value = await api<ReferenceAnalysis>(`/${id}`);
    if (activeId.current === id) accept(value);
  }, [accept]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api("/capabilities").then(() => { if (live) { setReady(true); setCapabilityError(null); } }).catch(e => { if (live) { setReady(false); setCapabilityError(e.message); } });
    api<ReferenceAnalysis[]>().then(rows => { if (live) setRecent(rows); }).catch(e => { if (live) setError(e.message); });
    if (!activeId.current) { const id = sessionStorage.getItem("reference-active-analysis"); if (id) void load(id).catch(e => { if (live) setError(e.message); }); }
    return () => { live = false; };
  }, [open, load]);
  const analysisId = analysis?.id; const analysisStatus = analysis?.status;
  useEffect(() => {
    if (!analysisId || !["queued", "processing"].includes(analysisStatus ?? "")) return;
    let live = true;
    const timer = setInterval(() => { api<ReferenceAnalysis>(`/${analysisId}`).then(value => { if (live && activeId.current === analysisId) { accept(value); setError(null); } }).catch(e => { if (live) setError(e.message); }); }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [analysisId, analysisStatus, accept]);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); if (!open && dialog.current?.open) dialog.current.close(); }, [open]);
  const newAnalysis = () => {
    activeId.current = null; createId.current = null; draftFor.current = null;
    setAnalysis(null); setDraft(null); setError(null); setNotice(""); setPlayback(null); setProgress(null); sessionStorage.removeItem("reference-active-analysis");
  };
  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const file = mode === "upload" ? fileRef.current?.files?.[0] : undefined;
      if (mode === "upload" && !file) throw new Error("Choose a video file first.");
      if (file && file.size > REFERENCE_MAX_BYTES) throw new Error("Choose a video up to 200 MB. Keep the full ad; do not trim its ending.");
      const source: ReferenceSource = file ? { mode, filename: file.name, mime_type: (file.type || "video/mp4") as ReferenceSource["mime_type"], size_bytes: file.size, url: "" } : { mode, url: url.trim(), filename: "", mime_type: "video/mp4", size_bytes: 0 };
      createId.current ??= crypto.randomUUID();
      const created = await api<ReferenceAnalysis>("", { id: createId.current, source, nameOverride: name.trim() }); accept(created);
      if (file && created.status === "uploading") { setProgress(0); await uploadReferenceVideo(created.id, file, () => api<{ upload_url: string }>(`/${created.id}/upload`, {}), setProgress); }
      accept(await api<ReferenceAnalysis>(`/${created.id}/submit`, {})); setProgress(null);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const resume = async () => {
    if (!analysis) return;
    setBusy(true); setError(null);
    try {
      if (analysis.status === "uploading" && analysis.source.mode === "upload") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("Reselect the original video to resume its upload.");
        if (file.name !== analysis.source.filename || file.size !== analysis.source.size_bytes) throw new Error("Choose the same video used for this analysis.");
        await uploadReferenceVideo(analysis.id, file, () => api<{ upload_url: string }>(`/${analysis.id}/upload`, {}), setProgress);
      }
      accept(await api<ReferenceAnalysis>(`/${analysis.id}/${analysis.status === "failed" ? "retry" : "submit"}`, {})); setProgress(null);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!analysis || !draft) return;
    if (analysis.referenceFormatId) {
      onCreated({ id: analysis.referenceFormatId, name: draft.name, duration: Math.max(5, Math.round(analysis.result!.duration_sec)), extracted: true, referenceAnalysisId: analysis.id });
      setNotice(`“${draft.name}” is selected in Script Studio.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const saved = await api<InlineFrameworkOption>(`/${analysis.id}/save`, draft); onCreated(saved);
      setAnalysis(current => current ? { ...current, referenceFormatId: saved.id } : current);
      setNotice(`“${saved.name}” is saved and selected in Script Studio.`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const seek = async (seconds: number) => {
    if (!analysis) return;
    seekTime.current = seconds;
    try { if (!playback) { setPlayback((await api<{ url: string }>(`/${analysis.id}/playback`)).url); } else if (player.current) player.current.currentTime = seconds; } catch (e) { fail(e); }
  };
  return <>
    <div className="mt-1 flex flex-wrap gap-3"><button type="button" className="text-xs font-medium text-brand-purple hover:underline" onClick={() => setOpen(true)}>+ Analyze a reference ad</button>{selectedAnalysisId && <button type="button" className="text-xs text-brand-purple underline" onClick={() => { setOpen(true); void load(selectedAnalysisId).catch(fail); }}>View reference reports</button>}</div>
    <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="m-auto h-[94dvh] w-[min(1200px,96vw)] max-w-none rounded-2xl border border-ink-200 bg-ink-50 p-0 text-ink-900 shadow-xl backdrop:bg-black/40" aria-labelledby="reference-title">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-200 bg-white p-4 sm:p-6"><div><h2 id="reference-title" className="text-xl font-semibold">Analyze a reference ad</h2><p className="mt-1 text-sm text-ink-500">Understand the creative. Review the evidence. Build a reusable framework.</p></div><button type="button" className="btn" onClick={() => setOpen(false)}>Close</button></div>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><label className="label" htmlFor="reference-recent">Recent analyses</label><select id="reference-recent" className="input" value={analysis?.id ?? ""} disabled={busy} onChange={e => { if (e.target.value) void load(e.target.value).catch(fail); }}><option value="">Choose an analysis</option>{recent.map(item => <option key={item.id} value={item.id}>{item.nameOverride || item.source.filename || item.source.url} · {item.status}</option>)}</select></div><button type="button" className="btn" disabled={busy} onClick={newAnalysis}>New analysis</button></div>
        {capabilityError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{capabilityError}</p>}
        {!analysis && <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-4">
          <div className="flex gap-3" role="radiogroup" aria-label="Video source">{(["upload", "youtube", "url"] as const).map(value => <label className="tag cursor-pointer" key={value}><input className="mr-1" type="radio" name="reference-source" checked={mode === value} disabled={busy} onChange={() => { setMode(value); createId.current = null; }} />{value === "upload" ? "Upload" : value === "youtube" ? "YouTube" : "Ad URL"}</label>)}</div>
          {mode === "upload" ? <div><label className="label" htmlFor="reference-file">Video file</label><input id="reference-file" ref={fileRef} type="file" className="input" accept=".mp4,.mov,.webm,.m4v" disabled={busy} onChange={() => { createId.current = null; }} /><p className="mt-1 text-xs text-ink-500">MP4, MOV, WEBM or M4V. Up to 200 MB and 10 minutes. Upload the complete ad.</p></div> : <div><label className="label" htmlFor="reference-url">{mode === "youtube" ? "Public YouTube video" : "Ad video link"}</label><input id="reference-url" className="input" type="url" value={url} disabled={busy} placeholder="https://…" onChange={e => { setUrl(e.target.value); createId.current = null; }} /><p className="mt-1 text-xs text-ink-500">The video must be publicly accessible. If a site blocks access, download it and use Upload.</p></div>}
          <div><label className="label" htmlFor="reference-name">Framework name (optional)</label><input id="reference-name" className="input" value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Let AI name the structure" /></div><button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? "Preparing analysis…" : "Analyze video"}</button>
        </div>}
        {analysis && !analysis.result && <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-5" aria-live="polite"><p className="font-semibold">{analysis.source.filename || analysis.source.url}</p><p>{analysis.status === "failed" ? "Analysis needs attention" : REFERENCE_STAGES[["uploading", "queued"].includes(analysis.status) ? analysis.status : analysis.stage] || analysis.stage}</p>{progress !== null && <div><progress className="w-full" max={100} value={progress} /><p className="text-sm">Uploading {Math.round(progress)}%</p></div>}<p className="text-sm text-ink-500">You can close this panel. Submitted analyses continue in the background and are saved in Recent analyses.</p>{analysis.error && <p className="text-sm text-red-700">{analysis.error}</p>}{analysis.status === "uploading" && !busy && analysis.source.mode === "upload" && <div><label className="label" htmlFor="reference-resume-file">Reselect the original video to resume</label><input id="reference-resume-file" ref={fileRef} type="file" accept=".mp4,.mov,.webm,.m4v" className="input" /></div>}{["uploading", "failed", "queued"].includes(analysis.status) && <button type="button" className="btn" disabled={busy || !ready} onClick={() => void resume()}>{busy ? "Working…" : analysis.status === "failed" ? "Retry failed stage" : analysis.status === "queued" ? "Ensure analysis is queued" : "Resume and analyze"}</button>}</div>}
        {playback && <video ref={player} controls src={playback} className="max-h-80 w-full rounded-xl bg-black" onLoadedMetadata={() => { if (player.current) player.current.currentTime = seekTime.current; }} onError={() => { setPlayback(null); setError("Playback link expired or unavailable. Click a timestamp to refresh it."); }} />}
        {analysis?.result && draft && <ReferenceReports key={analysis.id} report={analysis.result} draft={draft} setDraft={setDraft} saved={!!analysis.referenceFormatId} busy={busy} save={() => void save()} seek={s => void seek(s)} notify={setNotice} fail={setError} />}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}{notice && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900" role="status">{notice}</p>}
      </div>
    </dialog>
  </>;
}
