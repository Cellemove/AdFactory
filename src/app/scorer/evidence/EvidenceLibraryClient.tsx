"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Json, ScriptEvidenceRevisionRow, ScriptEvidenceRow } from "@/lib/database.types";
import {
  GOOGLE_SHEET_TABS,
  getJsonStringArray,
  getSourceLinks,
  type EditableEvidenceField,
  type EvidencePatch,
} from "@/lib/cellumove/evidence-library";

type Option = { value: string; label: string };
type Filters = {
  q: string;
  sheetName: string;
  sourceType: string;
  reviewStatus: string;
  evidenceLevel: string;
  angleSlug: string;
  hasScript: string;
  conflicts: string;
};
type Metrics = { spend: number | null; roas: number | null; hookRate: number | null; holdRate: number | null; cpc: number | null; cpatc: number | null };
type Draft = EvidencePatch & { metrics: Metrics };

const emptyFilters: Filters = { q: "", sheetName: "all", sourceType: "all", reviewStatus: "all", evidenceLevel: "all", angleSlug: "all", hasScript: "all", conflicts: "all" };
const emptyMetrics: Metrics = { spend: null, roas: null, hookRate: null, holdRate: null, cpc: null, cpatc: null };

export function EvidenceLibraryClient({ angles, markets }: { angles: Option[]; markets: Option[] }) {
  const [items, setItems] = useState<ScriptEvidenceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ScriptEvidenceRow | null>(null);
  const [revisions, setRevisions] = useState<ScriptEvidenceRevisionRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [importRunId, setImportRunId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importCounts, setImportCounts] = useState<Record<string, unknown> | null>(null);
  const [bulkField, setBulkField] = useState<"angleSlug" | "format" | "marketCode" | "evidenceLevel" | "reviewStatus">("reviewStatus");
  const [bulkValue, setBulkValue] = useState("shortlisted");

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    Object.entries({ ...filters, q: appliedQuery }).forEach(([key, value]) => {
      if (value && value !== "all") params.set(key, value);
    });
    try {
      const response = await fetch(`/api/scorer/evidence?${params}`, { cache: "no-store" });
      const body = await response.json() as { items?: ScriptEvidenceRow[]; total?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load scorer evidence.");
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
      setSelectedIds(new Set());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, filters, page]);

  useEffect(() => { void loadEvidence(); }, [loadEvidence]);

  useEffect(() => {
    if (!importRunId || importStatus === "complete" || importStatus === "failed") return;
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/scorer/evidence/imports/${importRunId}`, { cache: "no-store" });
      const body = await response.json() as { run?: { status: string; counts: Json }; error?: string };
      if (!response.ok || !body.run) {
        setImportStatus("failed");
        setError(body.error ?? "Could not read import status.");
        return;
      }
      setImportStatus(body.run.status);
      if (body.run.counts && typeof body.run.counts === "object" && !Array.isArray(body.run.counts)) setImportCounts(body.run.counts as Record<string, unknown>);
      if (body.run.status === "complete") {
        setMessage("Google Sheet import completed. Raw rows were preserved and the evidence library was refreshed.");
        void loadEvidence();
      }
      if (body.run.status === "failed") setError("The Google Sheet import failed. Open the run details or server log for the exact error.");
    }, 1_500);
    return () => window.clearInterval(interval);
  }, [importRunId, importStatus, loadEvidence]);

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  const startImport = async () => {
    setError(null);
    setMessage(null);
    setImportCounts(null);
    const response = await fetch("/api/scorer/evidence/imports/google-sheet", { method: "POST" });
    const body = await response.json() as { runId?: string; status?: string; error?: string };
    if (!response.ok || !body.runId) {
      setError(body.error ?? "Could not start the Google Sheet import.");
      return;
    }
    setImportRunId(body.runId);
    setImportStatus(body.status ?? "pending");
  };

  const openEvidence = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/scorer/evidence/${id}`, { cache: "no-store" });
      const body = await response.json() as { item?: ScriptEvidenceRow; revisions?: ScriptEvidenceRevisionRow[]; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error ?? "Could not open the evidence entry.");
      setActive(body.item);
      setDraft(toDraft(body.item));
      setRevisions(body.revisions ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const save = async (forcedPatch?: EvidencePatch) => {
    if (!active || !draft) return;
    const patch = forcedPatch ?? changedPatch(active, draft);
    if (!Object.keys(patch).length) {
      setMessage("No changes to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/scorer/evidence/${active.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: active.updatedAt, patch }),
      });
      const body = await response.json() as { item?: ScriptEvidenceRow; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error ?? "Could not save the evidence entry.");
      setActive(body.item);
      setDraft(toDraft(body.item));
      setItems((current) => current.map((item) => item.id === body.item!.id ? body.item! : item));
      setMessage("Evidence entry saved. The imported raw row was not changed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const resetField = async (field: EditableEvidenceField) => {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/scorer/evidence/${active.id}/reset-field`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, expectedUpdatedAt: active.updatedAt }),
      });
      const body = await response.json() as { item?: ScriptEvidenceRow; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error ?? "Could not reset the field.");
      setActive(body.item);
      setDraft(toDraft(body.item));
      setItems((current) => current.map((item) => item.id === body.item!.id ? body.item! : item));
      setMessage("Field restored to the latest imported source value.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const applyBulk = async () => {
    if (!selectedIds.size || !bulkValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const value = bulkValue.trim();
      const response = await fetch("/api/scorer/evidence", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], patch: { [bulkField]: value } }),
      });
      const body = await response.json() as { items?: ScriptEvidenceRow[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not apply the bulk update.");
      setMessage(`${selectedIds.size} evidence entries updated.`);
      await loadEvidence();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 p-5">
          <div>
            <div className="flex items-center gap-2"><h2 className="font-semibold">Google Sheet source</h2><span className="tag">3 tabs</span></div>
            <p className="mt-1 text-xs text-ink-500">Public read-only import. Changes made here never write back to Google Sheets.</p>
          </div>
          <button className="btn btn-primary" onClick={() => void startImport()} disabled={Boolean(importStatus && !["complete", "failed"].includes(importStatus))}>
            {importStatus && !["complete", "failed"].includes(importStatus) ? `Import ${importStatus}…` : "Import / refresh 3 tabs"}
          </button>
        </div>
        <div className="grid gap-px bg-ink-200 sm:grid-cols-3">
          {GOOGLE_SHEET_TABS.map((tab) => <div key={tab} className="bg-white p-4"><p className="text-xs font-semibold text-ink-700">{tab}</p><p className="mt-1 text-xs text-ink-500">{perTabCount(importCounts, tab)} candidates in latest run</p></div>)}
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">✓ {message}</p>}

      <section className="card space-y-4">
        <div className="flex justify-end">
          <span className="tag">Newest to oldest</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1"><span className="label">Search</span><div className="flex gap-2"><input className="input" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(filters.q); } }} placeholder="ID, title, avatar, angle, or script text" /><button className="btn" onClick={() => { setPage(1); setAppliedQuery(filters.q); }}>Search</button></div></label>
          <FilterSelect label="Tab" value={filters.sheetName} onChange={(value) => changeFilter("sheetName", value)} options={[{ value: "all", label: "All tabs" }, ...GOOGLE_SHEET_TABS.map((value) => ({ value, label: value.replace("Suley - ", "") }))]} />
          <FilterSelect label="Source" value={filters.sourceType} onChange={(value) => changeFilter("sourceType", value)} options={[{ value: "all", label: "All sources" }, { value: "milanote", label: "Milanote" }, { value: "google_drive", label: "Google Drive" }, { value: "google_docs", label: "Google Docs" }, { value: "external_html", label: "External HTML" }]} />
          <FilterSelect label="Review" value={filters.reviewStatus} onChange={(value) => changeFilter("reviewStatus", value)} options={statusOptions("All reviews", ["unreviewed", "needs_review", "shortlisted", "approved", "rejected", "excluded"])} />
          <FilterSelect label="Strength" value={filters.evidenceLevel} onChange={(value) => changeFilter("evidenceLevel", value)} options={statusOptions("All strengths", ["observed", "probable_winner", "verified_winner"])} />
          <FilterSelect label="Angle" value={filters.angleSlug} onChange={(value) => changeFilter("angleSlug", value)} options={[{ value: "all", label: "All angles" }, ...angles]} />
          <FilterSelect label="Script" value={filters.hasScript} onChange={(value) => changeFilter("hasScript", value)} options={[{ value: "all", label: "Any script state" }, { value: "true", label: "Script available" }, { value: "false", label: "Source only" }]} />
          <FilterSelect label="Conflict" value={filters.conflicts} onChange={(value) => changeFilter("conflicts", value)} options={[{ value: "all", label: "Any conflict state" }, { value: "true", label: "Has conflict" }, { value: "false", label: "No conflict" }]} />
          <button className="btn" onClick={() => { setFilters(emptyFilters); setAppliedQuery(""); setPage(1); }}>Clear</button>
        </div>

        {selectedIds.size > 0 && <div className="flex flex-wrap items-end gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <span className="mr-2 self-center text-xs font-semibold text-violet-900">{selectedIds.size} selected</span>
          <select className="input w-auto" value={bulkField} onChange={(event) => { const field = event.target.value as typeof bulkField; setBulkField(field); setBulkValue(defaultBulkValue(field)); }}><option value="reviewStatus">Review status</option><option value="evidenceLevel">Evidence strength</option><option value="angleSlug">Angle</option><option value="format">Format</option><option value="marketCode">Market</option></select>
          <BulkValue field={bulkField} value={bulkValue} onChange={setBulkValue} angles={angles} markets={markets} />
          <button className="btn btn-primary" disabled={saving || !bulkValue} onClick={() => void applyBulk()}>Apply</button>
        </div>}

        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500"><tr><th className="w-10 p-3"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? new Set() : new Set(items.map((item) => item.id)))} aria-label="Select visible evidence" /></th><th className="p-3">Evidence</th><th className="p-3">Provenance</th><th className="p-3">Sources</th><th className="p-3">Script</th><th className="p-3">Strength</th><th className="p-3">Review</th></tr></thead>
            <tbody className="divide-y divide-ink-200">
              {items.map((item) => {
                const conflicts = getJsonStringArray(item.conflictFields);
                return <tr key={item.id} className="cursor-pointer bg-white hover:bg-violet-50/40" onClick={() => void openEvidence(item.id)}>
                  <td className="p-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => setSelectedIds((current) => toggleSet(current, item.id))} aria-label={`Select ${item.title}`} /></td>
                  <td className="p-3"><p className="font-semibold text-ink-900">{item.externalId || "No external ID"}</p><p className="mt-0.5 max-w-xs truncate text-xs text-ink-500">{item.title}</p>{conflicts.length > 0 && <span className="mt-1 inline-flex text-xs font-semibold text-amber-700">⚠ {conflicts.length} source conflict{conflicts.length === 1 ? "" : "s"}</span>}</td>
                  <td className="p-3 text-xs text-ink-600">{item.sheetName ? <><p>{shortTab(item.sheetName)}</p><p className="text-ink-400">Row {item.sourceRow}</p></> : <span>Manual entry</span>}</td>
                  <td className="p-3"><div className="flex max-w-48 flex-wrap gap-1">{getJsonStringArray(item.sourceTypes).filter((type) => type !== "product_destination").map((type) => <span key={type} className="tag">{type.replaceAll("_", " ")}</span>)}</div></td>
                  <td className="p-3"><span className={item.scriptText?.trim() ? "tag tag-ok" : "tag tag-warn"}>{item.scriptText?.trim() ? "available" : "source only"}</span></td>
                  <td className="p-3"><span className={item.evidenceLevel === "verified_winner" ? "tag tag-ok" : "tag"}>{item.evidenceLevel.replaceAll("_", " ")}</span></td>
                  <td className="p-3"><span className="tag">{item.reviewStatus.replaceAll("_", " ")}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
          {!loading && items.length === 0 && <p className="p-10 text-center text-sm text-ink-500">No evidence matches these filters.</p>}
          {loading && <p className="p-10 text-center text-sm text-ink-500">Loading evidence…</p>}
        </div>

        <div className="flex items-center justify-between text-xs text-ink-500"><span>{total} matching entries · page {page} of {pageCount}</span><div className="flex gap-2"><button className="btn text-xs" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button className="btn text-xs" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
      </section>

      {active && draft && <EvidenceDrawer
        item={active}
        draft={draft}
        revisions={revisions}
        angles={angles}
        markets={markets}
        saving={saving}
        onChange={(patch) => setDraft((current) => current ? { ...current, ...patch } : current)}
        onClose={() => { setActive(null); setDraft(null); setRevisions([]); }}
        onSave={() => void save()}
        onDiscard={() => setDraft(toDraft(active))}
        onReset={(field) => void resetField(field)}
        onKeep={(field) => void save({ [field]: valueForField(active, field) } as EvidencePatch)}
      />}
    </div>
  );

  function changeFilter(key: keyof Filters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }
}

function EvidenceDrawer({ item, draft, revisions, angles, markets, saving, onChange, onClose, onSave, onDiscard, onReset, onKeep }: {
  item: ScriptEvidenceRow;
  draft: Draft;
  revisions: ScriptEvidenceRevisionRow[];
  angles: Option[];
  markets: Option[];
  saving: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onClose: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onReset: (field: EditableEvidenceField) => void;
  onKeep: (field: EditableEvidenceField) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);
  const overrides = getJsonStringArray(item.overrideFields);
  const conflicts = getJsonStringArray(item.conflictFields) as EditableEvidenceField[];
  const links = getSourceLinks(item.sourceLinks);
  const milanoteLink = links.find((link) => link.type === "milanote");
  const latest = revisions[0];

  const extractPdf = async (file: File) => {
    setExtracting(true);
    setExtractionError(null);
    setExtractionMessage(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("expectedUpdatedAt", item.updatedAt);
      const response = await fetch(`/api/scorer/evidence/${item.id}/extract-milanote`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json() as {
        extraction?: { scriptText: string; sectionLabels: string[]; excludedLabels: string[]; deconstructionText: string | null; deconstructionLabel: string | null };
        error?: string;
      };
      if (!response.ok || !body.extraction) throw new Error(body.error ?? "Could not extract the Milanote script.");
      const { scriptText, deconstructionText, deconstructionLabel, sectionLabels, excludedLabels } = body.extraction;
      onChange(deconstructionText ? { scriptText, deconstructionText } : { scriptText });
      const deconstruction = deconstructionText ? ` Captured "${deconstructionLabel ?? "Deconstruction"}" into Ad deconstruction.` : "";
      const excluded = excludedLabels.length
        ? ` Excluded: ${excludedLabels.join(", ")}.`
        : " No other columns were found on the board.";
      setExtractionMessage(`Extracted ${sectionLabels.length} final script section${sectionLabels.length === 1 ? "" : "s"}.${deconstruction}${excluded} Review the text below, then Save.`);
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/35" role="dialog" aria-modal="true" aria-label="Edit scorer evidence" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-200 bg-white/95 p-5 backdrop-blur"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Editable evidence</p><h2 className="mt-1 text-xl font-semibold">{item.externalId || item.title}</h2><p className="mt-1 text-xs text-ink-500">Raw source revisions stay locked.</p></div><button className="btn" onClick={onClose}>Close</button></div>
      <div className="space-y-6 p-5">
        {conflicts.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="text-sm font-semibold text-amber-950">Source changed after your edit</h3><div className="mt-3 space-y-2">{conflicts.map((field) => <div key={field} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span><strong>{field}</strong> has a newer imported value.</span><div className="flex gap-2"><button className="btn text-xs" onClick={() => onKeep(field)}>Keep my edit</button><button className="btn text-xs" onClick={() => onReset(field)}>Use latest source</button></div></div>)}</div></section>}

        <section className="grid gap-4 sm:grid-cols-2">
          <Editable label="External ID" field="externalId" overridden={overrides.includes("externalId")} onReset={onReset}><input className="input" value={draft.externalId ?? ""} onChange={(event) => onChange({ externalId: nullIfEmpty(event.target.value) })} /></Editable>
          <Editable label="Title" field="title" overridden={overrides.includes("title")} onReset={onReset}><input className="input" value={draft.title ?? ""} onChange={(event) => onChange({ title: event.target.value })} /></Editable>
          <Editable label="Format" field="format" overridden={overrides.includes("format")} onReset={onReset}><input className="input" value={draft.format ?? ""} onChange={(event) => onChange({ format: nullIfEmpty(event.target.value) })} placeholder="UGC, VSL, split screen…" /></Editable>
          <Editable label="Avatar" field="avatar" overridden={overrides.includes("avatar")} onReset={onReset}><input className="input" value={draft.avatar ?? ""} onChange={(event) => onChange({ avatar: nullIfEmpty(event.target.value) })} /></Editable>
          <Editable label="Angle" field="angleSlug" overridden={overrides.includes("angleSlug")} onReset={onReset}><select className="input" value={draft.angleSlug ?? ""} onChange={(event) => onChange({ angleSlug: nullIfEmpty(event.target.value) })}><option value="">Unclassified</option>{angles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Editable>
          <Editable label="Market" field="marketCode" overridden={overrides.includes("marketCode")} onReset={onReset}><select className="input" value={draft.marketCode ?? ""} onChange={(event) => onChange({ marketCode: nullIfEmpty(event.target.value) })}><option value="">Unknown</option>{markets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Editable>
          <Editable label="Date" field="adDate" overridden={overrides.includes("adDate")} onReset={onReset}><input className="input" value={draft.adDate ?? ""} onChange={(event) => onChange({ adDate: nullIfEmpty(event.target.value) })} placeholder="Preserve the source wording" /></Editable>
          <Editable label="Launched status" field="launchedStatus" overridden={overrides.includes("launchedStatus")} onReset={onReset}><input className="input" value={draft.launchedStatus ?? ""} onChange={(event) => onChange({ launchedStatus: nullIfEmpty(event.target.value) })} /></Editable>
          <Editable label="Source status" field="sourceStatus" overridden={overrides.includes("sourceStatus")} onReset={onReset}><input className="input" value={draft.sourceStatus ?? ""} onChange={(event) => onChange({ sourceStatus: nullIfEmpty(event.target.value) })} /></Editable>
          <Editable label="Primary source URL" field="primarySourceUrl" overridden={overrides.includes("primarySourceUrl")} onReset={onReset}><input className="input" type="url" value={draft.primarySourceUrl ?? ""} onChange={(event) => onChange({ primarySourceUrl: nullIfEmpty(event.target.value) })} /></Editable>
          <Editable label="Evidence strength" field="evidenceLevel" overridden={overrides.includes("evidenceLevel")} onReset={onReset}><select className="input" value={draft.evidenceLevel} onChange={(event) => onChange({ evidenceLevel: event.target.value as Draft["evidenceLevel"] })}><option value="observed">Observed</option><option value="probable_winner">Probable winner</option><option value="verified_winner">Verified winner</option></select></Editable>
          <Editable label="Review status" field="reviewStatus" overridden={overrides.includes("reviewStatus")} onReset={onReset}><select className="input" value={draft.reviewStatus} onChange={(event) => onChange({ reviewStatus: event.target.value as Draft["reviewStatus"] })}><option value="unreviewed">Unreviewed</option><option value="needs_review">Needs review</option><option value="shortlisted">Shortlisted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="excluded">Excluded</option></select></Editable>
          <Editable label="Intended use" field="intent" overridden={overrides.includes("intent")} onReset={onReset}><select className="input" value={draft.intent} onChange={(event) => onChange({ intent: event.target.value as Draft["intent"] })}><option value="structural_candidate">Structural candidate</option><option value="reference_only">Reference only</option></select></Editable>
        </section>

        <Editable label="Performance evidence" field="performanceEvidence" overridden={overrides.includes("performanceEvidence")} onReset={onReset}><textarea className="input min-h-24" value={draft.performanceEvidence ?? ""} onChange={(event) => onChange({ performanceEvidence: nullIfEmpty(event.target.value) })} placeholder="Required before marking verified winner: source, metric, time range." /></Editable>

        <section><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Performance metrics</h3><p className="mt-1 text-xs text-ink-500">Manual only. The shifted May columns are not mapped automatically.</p></div>{overrides.includes("metrics") && <button className="text-xs font-semibold text-violet-700" onClick={() => onReset("metrics")}>Reset</button>}</div><div className="mt-3 grid gap-3 sm:grid-cols-3">{(Object.keys(emptyMetrics) as Array<keyof Metrics>).map((key) => <label key={key}><span className="label">{key}</span><input className="input" type="number" step="any" value={draft.metrics[key] ?? ""} onChange={(event) => onChange({ metrics: { ...draft.metrics, [key]: event.target.value === "" ? null : Number(event.target.value) } })} /></label>)}</div></section>

        {milanoteLink && <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl"><h3 className="text-sm font-semibold text-violet-950">Import from Milanote</h3><p className="mt-1 text-xs leading-5 text-violet-800">Open the linked board, export it as PDF (Board menu → Export → PDF), then upload it here. Only the cards inside columns titled HOOK 1/2/3, BODY, SCRIPT or CTA are read, verbatim, into Exact script text; a column titled Deconstruction of the ads is copied into Ad deconstruction; system prompts, instructions, research and reference material are never opened.</p></div>
            <div className="flex flex-wrap gap-2"><a className="btn text-xs" href={milanoteLink.url} target="_blank" rel="noreferrer">Open Milanote</a><button className="btn btn-primary text-xs" type="button" disabled={saving || extracting} onClick={() => fileInputRef.current?.click()}>{extracting ? "Extracting…" : "Upload Milanote PDF"}</button></div>
          </div>
          <input ref={fileInputRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void extractPdf(file); }} />
          {extractionError && <p className="mt-3 rounded-lg border border-red-200 bg-white p-3 text-xs text-red-800">⚠ {extractionError}</p>}
          {extractionMessage && <p className="mt-3 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-emerald-800">✓ {extractionMessage}</p>}
        </section>}

        <Editable label="Exact script text" field="scriptText" overridden={overrides.includes("scriptText")} onReset={onReset}><textarea className="input min-h-[26rem] font-mono text-sm leading-6" value={draft.scriptText ?? ""} onChange={(event) => onChange({ scriptText: nullIfEmpty(event.target.value) })} placeholder="Paste the exact sourced script. Do not summarize or rewrite it." /></Editable>
        {!draft.scriptText?.trim() && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Source-only entries remain in the review queue but do not satisfy structural evidence requirements.</p>}
        <Editable label="Ad deconstruction" field="deconstructionText" overridden={overrides.includes("deconstructionText")} onReset={onReset}><textarea className="input min-h-40 text-sm leading-6" value={draft.deconstructionText ?? ""} onChange={(event) => onChange({ deconstructionText: nullIfEmpty(event.target.value) })} placeholder="The board's Deconstruction of the ads column (AI winning-ad workbook). Kept separate from the exact script." /></Editable>
        <Editable label="Reviewer notes" field="notes" overridden={overrides.includes("notes")} onReset={onReset}><textarea className="input min-h-24" value={draft.notes ?? ""} onChange={(event) => onChange({ notes: nullIfEmpty(event.target.value) })} /></Editable>

        <section className="rounded-xl border border-ink-200 bg-ink-50 p-4"><h3 className="text-sm font-semibold">Immutable provenance</h3><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-ink-400">Workbook</dt><dd className="mt-1 break-all">{item.spreadsheetId || "Manual entry"}</dd></div><div><dt className="text-ink-400">Tab and row</dt><dd className="mt-1">{item.sheetName ? `${item.sheetName} · row ${item.sourceRow}` : "Not applicable"}</dd></div><div><dt className="text-ink-400">Last imported</dt><dd className="mt-1">{item.lastImportedAt ? new Date(item.lastImportedAt).toLocaleString() : "Manual"}</dd></div><div><dt className="text-ink-400">Raw revisions</dt><dd className="mt-1">{revisions.length}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2">{links.map((link, index) => <a key={`${link.url}-${index}`} className="tag hover:border-violet-400" href={link.url} target="_blank" rel="noreferrer">{link.type.replaceAll("_", " ")} · {link.cellLabel}</a>)}</div>{latest && <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold">View latest locked raw row</summary><div className="mt-3 max-h-96 overflow-auto rounded-lg border border-ink-200 bg-white"><table className="w-full text-left text-xs"><tbody>{rawPairs(latest).map((pair) => <tr key={pair.index} className="border-b border-ink-100 align-top"><th className="w-48 p-2 text-ink-500">{pair.index + 1} · {pair.header || "Unnamed column"}</th><td className="whitespace-pre-wrap break-all p-2">{pair.value || <span className="text-ink-300">empty</span>}</td></tr>)}</tbody></table></div></details>}</section>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-200 bg-white py-4"><button className="btn" disabled={saving} onClick={onDiscard}>Discard changes</button><button className="btn btn-primary" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</button></div>
      </div>
    </aside>
  </div>;
}

function Editable({ label, field, overridden, onReset, children }: { label: string; field: EditableEvidenceField; overridden: boolean; onReset: (field: EditableEvidenceField) => void; children: React.ReactNode }) {
  return <label><span className="mb-1 flex items-center justify-between gap-2"><span className="label mb-0">{label}</span>{overridden && <button type="button" className="text-[11px] font-semibold text-violet-700" onClick={() => onReset(field)}>Reset to source</button>}</span>{children}</label>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Option[] }) {
  return <label><span className="label">{label}</span><select className="input min-w-36" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function BulkValue({ field, value, onChange, angles, markets }: { field: string; value: string; onChange: (value: string) => void; angles: Option[]; markets: Option[] }) {
  if (field === "reviewStatus") return <select className="input w-auto" value={value} onChange={(event) => onChange(event.target.value)}>{["unreviewed", "needs_review", "shortlisted", "approved", "rejected", "excluded"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>;
  if (field === "evidenceLevel") return <select className="input w-auto" value={value} onChange={(event) => onChange(event.target.value)}>{["observed", "probable_winner", "verified_winner"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>;
  if (field === "angleSlug") return <select className="input w-auto" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose angle</option>{angles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  if (field === "marketCode") return <select className="input w-auto" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose market</option>{markets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  return <input className="input w-48" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Format" />;
}

function toDraft(item: ScriptEvidenceRow): Draft {
  return {
    externalId: item.externalId,
    title: item.title,
    format: item.format,
    avatar: item.avatar,
    angleSlug: item.angleSlug,
    marketCode: item.marketCode,
    adDate: item.adDate,
    launchedStatus: item.launchedStatus,
    sourceStatus: item.sourceStatus,
    notes: item.notes,
    metrics: readMetrics(item.metrics),
    primarySourceUrl: item.primarySourceUrl,
    scriptText: item.scriptText,
    deconstructionText: item.deconstructionText,
    evidenceLevel: item.evidenceLevel as Draft["evidenceLevel"],
    performanceEvidence: item.performanceEvidence,
    reviewStatus: item.reviewStatus as Draft["reviewStatus"],
    intent: item.intent as Draft["intent"],
  };
}

function changedPatch(item: ScriptEvidenceRow, draft: Draft): EvidencePatch {
  const original = toDraft(item);
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key as keyof Draft]))) as EvidencePatch;
}

function readMetrics(value: Json): Metrics {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
  return Object.fromEntries(Object.keys(emptyMetrics).map((key) => [key, typeof record[key] === "number" ? record[key] : null])) as Metrics;
}

function valueForField(item: ScriptEvidenceRow, field: EditableEvidenceField): Json {
  if (field === "metrics") return item.metrics;
  return item[field as keyof ScriptEvidenceRow] as Json;
}

function rawPairs(revision: ScriptEvidenceRevisionRow): Array<{ index: number; header: string; value: string }> {
  const headers = Array.isArray(revision.rawHeaders) ? revision.rawHeaders.map(String) : [];
  const cells = Array.isArray(revision.rawCells) ? revision.rawCells.map(String) : [];
  return Array.from({ length: Math.max(headers.length, cells.length) }, (_, index) => ({ index, header: headers[index] ?? "", value: cells[index] ?? "" }));
}

function toggleSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

function statusOptions(allLabel: string, values: string[]): Option[] {
  return [{ value: "all", label: allLabel }, ...values.map((value) => ({ value, label: value.replaceAll("_", " ") }))];
}

function defaultBulkValue(field: string): string {
  if (field === "reviewStatus") return "shortlisted";
  if (field === "evidenceLevel") return "observed";
  return "";
}

function perTabCount(counts: Record<string, unknown> | null, tab: string): string {
  const perTab = counts?.perTab;
  if (!perTab || typeof perTab !== "object" || Array.isArray(perTab)) return "—";
  const value = (perTab as Record<string, unknown>)[tab];
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const candidates = (value as Record<string, unknown>).candidates;
  return typeof candidates === "number" ? String(candidates) : "—";
}

function shortTab(value: string): string {
  if (value.includes("Mai")) return "May 2026";
  if (value.includes("August")) return "August 2026";
  if (value.includes("SEPTEMBER")) return "September 2026";
  return value;
}

function nullIfEmpty(value: string): string | null { return value.trim() ? value : null; }
