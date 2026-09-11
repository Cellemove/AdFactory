"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CopyTaxonomyCodeRow, GoldAdRow, ScriptEvidenceRow } from "@/lib/database.types";
import { promoteEvidenceToGold, removeGoldAd } from "./actions";

type DraftBeat = { code: string; evidenceQuote: string; startSec: string; endSec: string; otherExplanation: string };

export function GoldBaselineManager({ ads, beatCounts, candidates, taxonomy, baselineVersion }: { ads: GoldAdRow[]; beatCounts: Record<string, number>; candidates: ScriptEvidenceRow[]; taxonomy: CopyTaxonomyCodeRow[]; baselineVersion: string }) {
  const router = useRouter();
  const [evidenceId, setEvidenceId] = useState(candidates[0]?.id ?? "");
  const [durationSec, setDurationSec] = useState("");
  const [beats, setBeats] = useState<DraftBeat[]>([emptyBeat(taxonomy[0]?.code ?? "")]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const candidate = candidates.find((item) => item.id === evidenceId) ?? null;
  const taxonomyByCode = useMemo(() => new Map(taxonomy.map((item) => [item.code, item])), [taxonomy]);
  const cohortCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ads.forEach((ad) => { const key = `${ad.angleSlug} · ${ad.format}`; counts.set(key, (counts.get(key) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ads]);

  const updateBeat = (index: number, patch: Partial<DraftBeat>) => setBeats((current) => current.map((beat, beatIndex) => beatIndex === index ? { ...beat, ...patch } : beat));
  const promote = () => startTransition(async () => {
    setMessage(null);
    try {
      await promoteEvidenceToGold({ evidenceId, durationSec: durationSec ? Number(durationSec) : null, beats: beats.map((beat) => ({ code: beat.code, evidenceQuote: beat.evidenceQuote, startSec: beat.startSec ? Number(beat.startSec) : null, endSec: beat.endSec ? Number(beat.endSec) : null, otherExplanation: beat.otherExplanation || null })) });
      setMessage("Evidence promoted to the gold baseline.");
      setBeats([emptyBeat(taxonomy[0]?.code ?? "")]); setDurationSec("");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  });
  const remove = (id: string) => startTransition(async () => {
    if (!window.confirm("Remove this ad and all of its coded beats from the active gold baseline?")) return;
    setMessage(null);
    try { await removeGoldAd(id); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  });

  return <div className="space-y-6">
    <section className="grid gap-4 md:grid-cols-3">
      <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Baseline</p><p className="mt-2 text-xl font-semibold">{baselineVersion}</p></div>
      <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Gold ads</p><p className="mt-2 text-xl font-semibold">{ads.length}</p></div>
      <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Eligible candidates</p><p className="mt-2 text-xl font-semibold">{candidates.length}</p><p className="mt-1 text-xs text-ink-500">Approved + verified winner + script attached</p></div>
    </section>

    <section className="card space-y-4">
      <div><h2 className="font-semibold">Promote and code a winner</h2><p className="mt-1 text-xs text-ink-500">Every beat quote must be copied exactly from the attached script. Timing is optional, but start and end must be supplied together.</p></div>
      {candidates.length ? <>
        <label><span className="label">Eligible evidence</span><select className="input" value={evidenceId} onChange={(event) => { setEvidenceId(event.target.value); setMessage(null); }}><option value="">Choose evidence…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.externalId ?? item.id} · {item.title}</option>)}</select></label>
        {candidate && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="rounded-xl border border-ink-200 bg-ink-50 p-4"><div className="flex flex-wrap gap-1.5"><span className="tag">{candidate.angleSlug}</span><span className="tag">{candidate.format}</span><span className="tag">{candidate.marketCode ?? "all markets"}</span></div><p className="mt-3 text-sm font-medium">{candidate.title}</p><pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5">{candidate.scriptText}</pre></div><div className="space-y-3"><label><span className="label">Total duration in seconds</span><input className="input" type="number" min="1" max="600" step="0.1" value={durationSec} onChange={(event) => setDurationSec(event.target.value)} placeholder="Optional" /></label>{beats.map((beat, index) => { const taxon = taxonomyByCode.get(beat.code); const quoteMissing = Boolean(beat.evidenceQuote && candidate.scriptText && !candidate.scriptText.includes(beat.evidenceQuote)); return <div key={index} className="rounded-xl border border-ink-200 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">Beat {index + 1}</p><button type="button" className="text-xs text-red-700 underline disabled:opacity-40" disabled={beats.length === 1} onClick={() => setBeats((current) => current.filter((_, beatIndex) => beatIndex !== index))}>Remove</button></div><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="md:col-span-2"><span className="label">Taxonomy code</span><select className="input" value={beat.code} onChange={(event) => updateBeat(index, { code: event.target.value })}>{taxonomy.map((item) => <option key={item.code} value={item.code}>{item.layer} · {item.label} ({item.code})</option>)}</select></label><div><span className="label">Layer</span><div className="input bg-ink-50">{taxon?.layer ?? "—"}</div></div></div><label className="mt-3 block"><span className="label">Exact script quote</span><textarea className={`input min-h-20 ${quoteMissing ? "border-red-400" : ""}`} value={beat.evidenceQuote} onChange={(event) => updateBeat(index, { evidenceQuote: event.target.value })} /></label>{quoteMissing && <p className="mt-1 text-xs text-red-700">This is not an exact substring of the script.</p>}<div className="mt-3 grid gap-3 md:grid-cols-2"><label><span className="label">Start second</span><input className="input" type="number" min="0" step="0.1" value={beat.startSec} onChange={(event) => updateBeat(index, { startSec: event.target.value })} /></label><label><span className="label">End second</span><input className="input" type="number" min="0" step="0.1" value={beat.endSec} onChange={(event) => updateBeat(index, { endSec: event.target.value })} /></label></div>{taxon?.layer === "OTHER" && <label className="mt-3 block"><span className="label">Why this is OTHER</span><input className="input" value={beat.otherExplanation} onChange={(event) => updateBeat(index, { otherExplanation: event.target.value })} /></label>}</div>; })}<button type="button" className="btn" onClick={() => setBeats((current) => [...current, emptyBeat(taxonomy[0]?.code ?? "")])}>Add beat</button><div className="flex flex-wrap items-center gap-3"><button type="button" className="btn btn-primary" disabled={pending || !evidenceId || beats.some((beat) => !beat.code || !beat.evidenceQuote.trim())} onClick={promote}>{pending ? "Saving…" : "Promote to gold baseline"}</button>{message && <p role="status" className="text-sm text-ink-600">{message}</p>}</div></div></div>}
      </> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No evidence is eligible yet. In the evidence library, add performance evidence, set evidence strength to <strong>verified winner</strong>, set review status to <strong>approved</strong>, and ensure the script, angle, and format are present.</div>}
    </section>

    <section className="card"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Current gold ads</h2><p className="mt-1 text-xs text-ink-500">Removing an ad also removes its coded beats from the active baseline.</p></div>{cohortCounts.length > 0 && <div className="flex flex-wrap gap-1.5">{cohortCounts.map(([cohort, count]) => <span key={cohort} className={count >= 5 ? "tag tag-ok" : "tag tag-warn"}>{cohort}: {count}/5</span>)}</div>}</div><div className="divider" />{ads.length ? <ul className="divide-y divide-ink-200">{ads.map((ad) => <li key={ad.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{ad.title}</p><div className="mt-1 flex flex-wrap gap-1.5 text-xs"><span className="tag">{ad.angleSlug}</span><span className="tag">{ad.format}</span><span className="tag">{beatCounts[ad.id] ?? 0} beats</span></div></div><button type="button" className="btn btn-ghost text-xs text-red-700" disabled={pending} onClick={() => remove(ad.id)}>Remove</button></li>)}</ul> : <p className="text-sm text-ink-500">No ads have been promoted to this baseline.</p>}</section>
  </div>;
}

function emptyBeat(code: string): DraftBeat {
  return { code, evidenceQuote: "", startSec: "", endSec: "", otherExplanation: "" };
}
