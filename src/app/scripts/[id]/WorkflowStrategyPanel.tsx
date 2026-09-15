"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScriptDocument, ScriptModule } from "@/lib/cellumove/script-studio";
import type { ScriptWorkflowAuditRunRow, ScriptWorkflowFindingRow } from "@/lib/database.types";

type AuditResult = {
  run: ScriptWorkflowAuditRunRow | null;
  findings: ScriptWorkflowFindingRow[];
};

const GATE_META: Record<string, { label: string; className: string }> = {
  pass: { label: "Playbook pass", className: "text-emerald-700" },
  needs_refinement: { label: "Needs refinement", className: "text-amber-700" },
  weak_alignment: { label: "Weak alignment", className: "text-red-700" },
  failed: { label: "Audit failed", className: "text-red-700" },
  pending: { label: "Checking", className: "text-ink-500" },
};
const DEFAULT_GATE_META = { label: "Checking", className: "text-ink-500" };

function evidenceLabel(count: number, target?: number): { value: string; className: string } {
  if (target != null && count < target) return { value: `${count}/${target}`, className: "text-amber-700" };
  return { value: String(count), className: "text-emerald-700" };
}

export function WorkflowStrategyPanel({
  projectId,
  document,
  revision,
  version,
  draftMatchesVersion,
  onApplyModules,
}: {
  projectId: string;
  document: ScriptDocument;
  revision: number;
  version: number;
  draftMatchesVersion: boolean;
  onApplyModules: (modules: Array<Pick<ScriptModule, "id" | "spokenText" | "onScreenText" | "visualDirection">>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<AuditResult>({ run: null, findings: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<"load" | "audit" | "fix" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const auditedDocumentRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setPending("load");
    fetch(`/api/scripts/${encodeURIComponent(projectId)}/workflow-audits/latest`)
      .then(async (response) => {
        const body = await response.json() as AuditResult & { error?: string };
        if (!response.ok) throw new Error(body.error || "The Workflow audit could not be loaded.");
        if (!active) return;
        setResult(body);
        if (body.run?.revision === revision) auditedDocumentRef.current = JSON.stringify(document);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => active && setPending(null));
    return () => { active = false; };
    // The latest audit is project-scoped; local edits intentionally do not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currentSerialized = JSON.stringify(document);
  const stale = Boolean(result.run) && (
    result.run!.revision !== revision
    || (auditedDocumentRef.current !== null && auditedDocumentRef.current !== currentSerialized)
  );
  const fixable = useMemo(() => result.findings.filter((finding) => finding.fixEligible), [result.findings]);
  const gate = GATE_META[result.run?.gateStatus ?? "pending"] ?? DEFAULT_GATE_META;
  const receipt = document.workflow.evidence;
  const readiness = [
    { label: "Verified verbatims", ...evidenceLabel(receipt.verbatimIds.length, 8) },
    { label: "Approved facts", ...evidenceLabel(receipt.factIds.length) },
    { label: "Approved offers", ...evidenceLabel(receipt.offerIds.length) },
    { label: "References", ...evidenceLabel(receipt.referenceIds.length) },
  ];

  const rerunAudit = async () => {
    setPending("audit");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/scripts/${encodeURIComponent(projectId)}/workflow-audits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, expectedRevision: revision, scriptVersion: draftMatchesVersion ? version : null }),
      });
      const body = await response.json() as AuditResult & { error?: string };
      if (!response.ok || !body.run) throw new Error(body.error || "The Workflow audit did not return a result.");
      setResult(body);
      setSelected(new Set());
      auditedDocumentRef.current = currentSerialized;
      setNotice("Workflow audit refreshed for the document currently on screen.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(null);
    }
  };

  const fixSelected = async () => {
    if (!result.run || selected.size === 0 || stale) return;
    setPending("fix");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/scripts/${encodeURIComponent(projectId)}/workflow-fixes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditRunId: result.run.id, findingIds: [...selected], expectedRevision: revision, document }),
      });
      const body = await response.json() as { patches?: Array<{ id: string; before: Pick<ScriptModule, "spokenText" | "onScreenText" | "visualDirection">; after: Pick<ScriptModule, "id" | "spokenText" | "onScreenText" | "visualDirection"> }>; error?: string };
      if (!response.ok || !body.patches) throw new Error(body.error || "The selected fixes could not be prepared.");
      onApplyModules(body.patches.map((patch) => patch.after));
      setSelected(new Set());
      setNotice("Suggested changes were applied as unsaved edits. Review them before saving.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-label="Creative strategy and Workflow audit" className="overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-pop">
      <button type="button" className="flex w-full items-start justify-between gap-3 bg-ink-900 px-4 py-4 text-left text-white" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span>
          <span className="block font-semibold tracking-tight">Creative strategy</span>
          <span className="mt-0.5 block text-xs text-white/65">Brief · readiness · Workflow audit</span>
        </span>
        <span className="flex items-center gap-2">
          {result.run?.score != null && <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{result.run.score}/100</span>}
          <span aria-hidden="true" className={`text-lg transition ${expanded ? "rotate-180" : ""}`}>⌄</span>
        </span>
      </button>

      <div className="border-b border-ink-200 px-4 py-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className={gate.className}>{result.run ? gate.label : pending === "load" ? "Loading audit…" : "Not audited"}</span>
          {stale && <span className="font-semibold text-amber-700">Stale after edits</span>}
        </div>
      </div>

      {expanded && <div className="max-h-[calc(100dvh-14rem)] space-y-5 overflow-y-auto p-4">
        <section>
          <p className="label">Idea brief</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">{document.workflow.brief.conceptLabel}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="tag">Heat {document.workflow.brief.heatLevel}</span>
            <span className="tag">{document.workflow.brief.funnelStage}</span>
            <span className="tag">{document.workflow.brief.marketCode}</span>
            <span className="tag">{document.workflow.brief.referenceMode.replaceAll("_", " ")}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-500">{document.workflow.brief.voicePlan}</p>
          {document.workflow.brief.hookDirection && <p className="mt-2 border-l-2 border-brand-pink/50 pl-2 text-xs leading-5 text-ink-600">Hook: {document.workflow.brief.hookDirection}</p>}
        </section>

        <section className="border-t border-ink-200 pt-4">
          <div className="flex items-center justify-between gap-3"><p className="label">Evidence readiness</p><span className="text-[10px] text-ink-400">Advisory</span></div>
          <dl className="mt-2 space-y-1.5 text-xs">{readiness.map((item) => <div key={item.label} className="flex justify-between gap-3"><dt className="text-ink-500">{item.label}</dt><dd className={`font-semibold ${item.className}`}>{item.value}</dd></div>)}</dl>
          {receipt.verbatimIds.length < 8 && <p className="mt-2 text-[11px] leading-4 text-amber-700">The playbook target is 8–12 verified verbatims. Generation stays available with a warning.</p>}
        </section>

        {document.fiveD && <section className="border-t border-ink-200 pt-4">
          <p className="label">5D strategy</p>
          <dl className="mt-2 space-y-2 text-xs">
            <div><dt className="font-semibold text-ink-700">Avatar</dt><dd className="mt-0.5 text-ink-500">{document.fiveD.avatar}</dd></div>
            <div><dt className="font-semibold text-ink-700">Angle</dt><dd className="mt-0.5 text-ink-500">{document.fiveD.angle}</dd></div>
            <div><dt className="font-semibold text-ink-700">Format</dt><dd className="mt-0.5 text-ink-500">{document.fiveD.videoFormat}</dd></div>
            <div><dt className="font-semibold text-ink-700">Identity shift</dt><dd className="mt-0.5 text-ink-500">{document.fiveD.identityLevel}</dd></div>
            <div><dt className="font-semibold text-ink-700">Dynamism</dt><dd className="mt-0.5 text-ink-500">{document.fiveD.dynamismLevel}</dd></div>
          </dl>
        </section>}

        <section className="border-t border-ink-200 pt-4">
          <div className="flex items-center justify-between gap-3"><p className="label">Workflow audit</p>{result.run?.score != null && <span className={`text-sm font-semibold ${gate.className}`}>{result.run.score}/100</span>}</div>
          <p className="mt-1 text-[11px] leading-4 text-ink-500">Playbook adherence only. Factual support remains in the separate Evidence scorer.</p>
          {result.findings.length > 0 ? <div className="mt-3 space-y-2">{result.findings.map((finding) => {
            const checked = selected.has(finding.id);
            return <label key={finding.id} className="block rounded-xl border border-ink-200 p-2.5 text-xs">
              <span className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" disabled={!finding.fixEligible || stale || pending !== null} checked={checked} onChange={() => setSelected((current) => { const next = new Set(current); checked ? next.delete(finding.id) : next.add(finding.id); return next; })} />
                <span className="min-w-0"><span className="font-semibold text-ink-800">{finding.category} · −{finding.pointsDeducted}</span><span className="mt-1 block leading-4 text-ink-600">{finding.message}</span><q className="mt-1 block line-clamp-2 border-l border-ink-300 pl-2 text-ink-400">{finding.scriptQuote}</q></span>
              </span>
            </label>;
          })}</div> : <p className="mt-3 text-xs text-ink-500">{result.run ? "No deductions were returned." : "Run the audit to inspect the current draft."}</p>}
          <div className="mt-3 grid gap-2">
            <button type="button" className="btn btn-primary w-full" disabled={!result.run || selected.size === 0 || stale || pending !== null} onClick={fixSelected}>{pending === "fix" ? "Preparing patch…" : `Fix selected${selected.size ? ` (${selected.size})` : ""}`}</button>
            <button type="button" className="btn w-full" disabled={pending !== null} onClick={rerunAudit}>{pending === "audit" ? "Auditing…" : "Rerun audit"}</button>
          </div>
          {stale && <p className="mt-2 text-[11px] leading-4 text-amber-700">The document changed after this audit. Rerun before requesting a fix.</p>}
          {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] leading-4 text-red-700">{error}</p>}
          {notice && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-[11px] leading-4 text-emerald-700">{notice}</p>}
        </section>

        <section className="border-t border-ink-200 pt-4">
          <p className="label">Source receipts</p>
          <p className="mt-1 text-[11px] text-ink-500">Playbook {document.workflow.playbook.version} · {document.workflow.playbook.sourceHash.slice(0, 12)}</p>
          {document.sourceRefs.length ? <ul className="mt-2 space-y-1 text-xs">{document.sourceRefs.map((source, index) => <li key={`${source.type}-${source.id ?? index}`} className="truncate text-ink-600">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">{source.title} ↗</a> : source.title}</li>)}</ul> : <p className="mt-2 text-xs text-ink-400">No external reference receipts.</p>}
        </section>
      </div>}
    </section>
  );
}
