"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createScorerEvidenceScript } from "@/app/actions/scorer-evidence";
import type { CreateScorerEvidenceInput, ScorerEvidencePayload } from "@/lib/cellumove/scorer-evidence";

type Option = { value: string; label: string };
type StoredEvidence = ScorerEvidencePayload & { id: string; createdAt: string };

const emptyFields: Record<string, string[]> = {};

export function EvidenceIntakeClient({
  angles,
  markets,
  evidence,
}: {
  angles: Option[];
  markets: Option[];
  evidence: StoredEvidence[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>(emptyFields);
  const [form, setForm] = useState<CreateScorerEvidenceInput>({
    externalId: "",
    title: "",
    sourceUrl: "",
    angleSlug: angles[0]?.value ?? "",
    format: "UGC",
    marketCode: "",
    durationSec: null,
    evidenceLevel: "observed",
    intent: "structural_candidate",
    performanceEvidence: "",
    notes: "",
    scriptText: "",
  });

  const set = <K extends keyof CreateScorerEvidenceInput>(key: K, value: CreateScorerEvidenceInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: [] }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setFieldErrors(emptyFields);
    startTransition(async () => {
      const result = await createScorerEvidenceScript(form);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? emptyFields);
        return;
      }
      setMessage(result.reused ? result.warning : ["Evidence script stored.", result.warning].filter(Boolean).join(" "));
      if (!result.reused) {
        setForm((current) => ({ ...current, externalId: "", title: "", sourceUrl: "", performanceEvidence: "", notes: "", scriptText: "" }));
      }
      router.refresh();
    });
  };

  const loadTextFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000) {
      setError("The text file is larger than 200 KB.");
      return;
    }
    set("scriptText", await file.text());
    if (!form.title) set("title", file.name.replace(/\.[^.]+$/, ""));
  };

  const fieldError = (name: string) => fieldErrors[name]?.[0]
    ? <p className="mt-1 text-xs text-red-700">{fieldErrors[name]![0]}</p>
    : null;

  return (
    <div className="space-y-6">
      <form className="card space-y-5" onSubmit={submit}>
        <div>
          <h2 className="font-semibold">Add an evidence script</h2>
          <p className="mt-1 text-sm text-ink-500">Paste the exact source text or load a local .txt/.md file. Nothing is rewritten.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label><span className="label">Title *</span><input className="input" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="SU0900002IO · Ozempic loss split screen" />{fieldError("title")}</label>
          <label><span className="label">External ID</span><input className="input" value={form.externalId ?? ""} onChange={(event) => set("externalId", event.target.value)} placeholder="SU0900002IO" /></label>
          <label><span className="label">Angle *</span><select className="input" value={form.angleSlug} onChange={(event) => set("angleSlug", event.target.value)}>{angles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{fieldError("angleSlug")}</label>
          <label><span className="label">Format *</span><input className="input" list="evidence-formats" value={form.format} onChange={(event) => set("format", event.target.value)} /><datalist id="evidence-formats"><option value="UGC" /><option value="Founder" /><option value="VSL" /><option value="Voiceover" /><option value="Static" /></datalist>{fieldError("format")}</label>
          <label><span className="label">Market</span><select className="input" value={form.marketCode ?? ""} onChange={(event) => set("marketCode", event.target.value)}><option value="">Unknown / cross-market</option>{markets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span className="label">Duration, seconds</span><input className="input" type="number" min="1" max="3600" step="0.1" value={form.durationSec ?? ""} onChange={(event) => set("durationSec", event.target.value ? Number(event.target.value) : null)} /></label>
          <label><span className="label">Evidence strength *</span><select className="input" value={form.evidenceLevel} onChange={(event) => set("evidenceLevel", event.target.value as CreateScorerEvidenceInput["evidenceLevel"])}><option value="observed">Observed creative</option><option value="probable_winner">Probable winner · proxy signals</option><option value="verified_winner">Verified winner · performance data</option></select></label>
          <label><span className="label">Intended use *</span><select className="input" value={form.intent} onChange={(event) => set("intent", event.target.value as CreateScorerEvidenceInput["intent"])}><option value="structural_candidate">Structural baseline candidate</option><option value="reference_only">Reference only</option></select></label>
          <label className="md:col-span-2"><span className="label">Source URL</span><input className="input" type="url" value={form.sourceUrl ?? ""} onChange={(event) => set("sourceUrl", event.target.value)} placeholder="https://…" />{fieldError("sourceUrl")}</label>
          <label className="md:col-span-2"><span className="label">Performance evidence</span><textarea className="input min-h-20" value={form.performanceEvidence ?? ""} onChange={(event) => set("performanceEvidence", event.target.value)} placeholder="For example: ROAS 2.4, $18k spend, source report and date. Required only for verified winner." />{fieldError("performanceEvidence")}</label>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-2"><label htmlFor="evidence-script" className="label">Exact script *</label><label className="btn cursor-pointer text-xs">Load .txt or .md<input className="sr-only" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void loadTextFile(event.target.files?.[0])} /></label></div>
          <textarea id="evidence-script" className="input mt-2 min-h-[28rem] font-mono text-sm leading-6" value={form.scriptText} onChange={(event) => set("scriptText", event.target.value)} placeholder={'HOOK A — SPLIT SCREEN (0:00–0:05)\n\nVO: "…"\n\nVISUAL: …\n\nTEXT: …'} />
          {fieldError("scriptText")}
        </div>

        <label><span className="label">Review notes</span><textarea className="input min-h-20" value={form.notes ?? ""} onChange={(event) => set("notes", event.target.value)} placeholder="Context, ambiguity, or instructions for the reviewer." /></label>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        <div className="flex justify-end"><button className="btn btn-primary" disabled={pending}>{pending ? "Storing evidence…" : "Store evidence script"}</button></div>
      </form>

      <section className="card">
        <div className="flex items-end justify-between gap-3"><div><h2 className="font-semibold">Staged evidence</h2><p className="mt-1 text-xs text-ink-500">Preserved source records awaiting taxonomy and variant review.</p></div><span className="tag">{evidence.length}</span></div>
        <div className="divider" />
        {evidence.length ? <ul className="divide-y divide-ink-200">{evidence.map((item) => (
          <li key={item.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs text-ink-500">{item.externalId || item.id} · {new Date(item.createdAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-1.5"><span className="tag">{item.angleSlug}</span><span className="tag">{item.format}</span><span className={item.evidenceLevel === "verified_winner" ? "tag tag-ok" : "tag tag-warn"}>{item.evidenceLevel.replaceAll("_", " ")}</span><span className="tag">needs review</span></div></div>
            {item.alternativeHookCount > 1 && <p className="mt-2 text-xs text-amber-800">⚠ {item.alternativeHookCount} alternative hooks detected; they are not treated as sequential beats.</p>}
            <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-ink-600">View stored script</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-50 p-4 text-xs leading-5">{item.scriptText}</pre></details>
          </li>
        ))}</ul> : <p className="text-sm text-ink-500">No evidence scripts have been entered yet.</p>}
      </section>
    </div>
  );
}
