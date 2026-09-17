"use client";

import { useState } from "react";
import { REFERENCE_SECTIONS, reportMarkdown, sceneTime, scriptCsv, type ReferenceFinding, type ReferenceFramework, type ReferenceResult } from "@/lib/cellumove/reference-analysis";

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const labels = { belief_progression: "Belief progression", proof_requirements: "Proof requirements", pacing: "Pacing", objections: "Objections", adaptation_cautions: "Adaptation cautions" };
interface Props {
  report: ReferenceResult; draft: ReferenceFramework; setDraft: (draft: ReferenceFramework) => void;
  saved: boolean; busy: boolean; save: () => void; seek: (seconds: number) => void;
  notify: (message: string) => void; fail: (message: string) => void;
}
export function ReferenceReports({ report, draft, setDraft, saved, busy, save, seek, notify, fail }: Props) {
  const [tab, setTab] = useState("deconstruction");
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); notify("Copied to clipboard."); } catch { fail("Clipboard access failed. Use the download instead."); } };
  const citations = (ids: string[]) => <div className="flex flex-wrap gap-2">{ids.map(id => { const scene = report.scenes.find(s => s.id === id); return scene ? <button type="button" className="text-xs text-brand-purple underline" key={id} onClick={() => seek(scene.start_sec)}>{sceneTime(scene)}</button> : null; })}</div>;
  const finding = (item: ReferenceFinding, key: string) => <article key={key} className="space-y-2 rounded-xl border border-ink-200 bg-white p-4">
    <p className="text-xs uppercase tracking-wide text-ink-500">{item.classification.replaceAll("_", " ")} · {item.confidence} confidence</p>
    <p className="whitespace-pre-wrap font-medium">{item.observation}</p>{citations(item.evidence_scene_ids)}
    <p className="whitespace-pre-wrap text-sm"><strong>Interpretation:</strong> {item.interpretation}</p>
    <p className="whitespace-pre-wrap text-sm"><strong>Creative implication:</strong> {item.creative_implication}</p>
  </article>;
  return <>
    {!saved && tab !== "framework" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">This analysis is not in your Reference Framework list yet. Review the reports, then <button type="button" className="font-semibold underline" onClick={() => setTab("framework")}>save it as a framework</button> to use it in Script Studio.</p>}
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Analysis reports">{["deconstruction", "script", "framework"].map(value => <button type="button" role="tab" aria-selected={tab === value} aria-controls={`reference-${value}`} key={value} className={`btn ${tab === value ? "btn-primary" : ""}`} onClick={() => setTab(value)}>{value === "deconstruction" ? "Deconstruction" : value === "script" ? "Frame-by-frame Script" : "Reusable Framework"}</button>)}</div>
    {tab === "deconstruction" && <div role="tabpanel" id="reference-deconstruction" className="space-y-5">
      <div className="flex flex-wrap gap-2"><button type="button" className="btn" onClick={() => void copy(reportMarkdown(report))}>Copy deconstruction</button><button type="button" className="btn" onClick={() => download(reportMarkdown(report), "ad-deconstruction.md", "text/markdown;charset=utf-8")}>Download Markdown</button></div>
      <section className="space-y-3"><h3 className="text-xl font-semibold">Ad Overview and Strategic Thesis</h3><p className="text-sm text-ink-500">{report.deconstruction.ad_name} · {report.deconstruction.brand} · {report.deconstruction.product_category}</p>{finding(report.deconstruction.strategic_thesis, "thesis")}</section>
      {report.deconstruction.sections.map(section => <section key={section.number} className="space-y-3"><h3 className="text-lg font-semibold">Part {section.number}: {REFERENCE_SECTIONS[section.number - 1]}</h3>{section.findings.map((f, i) => finding(f, `${section.number}-${i}`))}</section>)}
      <div className="space-y-3">{report.deconstruction.experiments.map(e => <article key={e.priority} className="space-y-2 rounded-xl border border-ink-200 bg-white p-4"><h4 className="font-semibold">Test {e.priority}: {e.change}</h4><p>{e.rationale}</p>{citations(e.evidence_scene_ids)}<p className="text-sm"><strong>Primary metric:</strong> {e.primary_metric}</p><p className="text-sm"><strong>Interpretation:</strong> {e.interpretation}</p></article>)}</div>
    </div>}
    {tab === "script" && <div role="tabpanel" id="reference-script" className="space-y-3">
      <div className="flex flex-wrap gap-2"><button type="button" className="btn" onClick={() => void copy(scriptCsv(report))}>Copy script</button><button type="button" className="btn" onClick={() => download(scriptCsv(report), "frame-by-frame-script.csv", "text/csv;charset=utf-8")}>Download CSV</button></div>
      <p className="text-xs text-ink-500">Timestamped storyboard. Speech and overlays retain the source language; uncertain details are marked for review.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr>{["Timestamp", "Visual / Graphic Scene", "Audio / Voiceover", "Editing Cues & Text Overlays"].map(label => <th className="border border-ink-200 bg-white p-3" key={label}>{label}</th>)}</tr></thead><tbody>{report.scenes.map(s => <tr key={s.id}><td className="border border-ink-200 p-3 align-top"><button type="button" className="whitespace-nowrap text-brand-purple underline" onClick={() => seek(s.start_sec)}>{sceneTime(s)}</button></td><td className="whitespace-pre-wrap border border-ink-200 p-3 align-top">{s.visual}</td><td className="whitespace-pre-wrap border border-ink-200 p-3 align-top">{s.audio}</td><td className="whitespace-pre-wrap border border-ink-200 p-3 align-top">{s.overlays}{s.uncertainty && <p className="mt-2 text-amber-800">Uncertainty: {s.uncertainty}</p>}</td></tr>)}</tbody></table></div>
    </div>}
    {tab === "framework" && <div role="tabpanel" id="reference-framework" className="space-y-4">
      <p className="text-sm text-ink-500">Review the structure and transferable strategy. Product claims and offers will come from your selected product’s approved knowledge.</p>
      <label className="block"><span className="label">Framework name</span><input className="input" maxLength={80} value={draft.name} disabled={saved} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <p>{draft.description}</p><p className="text-sm text-ink-500">{draft.best_for_angle}</p>
      {draft.beats.map((beat, index) => <label key={index} className="block"><span className="label">{beat.label} · {beat.start_sec}–{beat.end_sec}s</span><textarea className="input min-h-20" maxLength={400} value={beat.note} disabled={saved} onChange={e => setDraft({ ...draft, beats: draft.beats.map((b, i) => i === index ? { ...b, note: e.target.value } : b) })} /></label>)}
      {(Object.keys(labels) as Array<keyof typeof labels>).map(key => <label key={key} className="block"><span className="label">{labels[key]}</span><textarea className="input min-h-28" maxLength={3000} value={draft.strategy[key]} disabled={saved} onChange={e => setDraft({ ...draft, strategy: { ...draft.strategy, [key]: e.target.value } })} /></label>)}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : saved ? "Use saved framework" : "Save and use framework"}</button>
    </div>}
  </>;
}
