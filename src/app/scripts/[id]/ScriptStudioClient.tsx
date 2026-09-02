"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type TextareaHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { assistScriptModule, generateScriptProjectDraft, saveScriptDocument, sendScriptProjectToEditor, snapshotScriptProject, suggestScriptHookAlternatives } from "@/app/actions/scripts";
import { appendHookAlternatives, MAX_SCRIPT_HOOK_ALTERNATIVES } from "@/lib/cellumove/script-hook-alternatives";
import { inspectScriptQuality, renderScriptDownload, scriptDownloadFilename, type ScriptDocument, type ScriptModule } from "@/lib/cellumove/script-studio";
import { canEditScript, canSendScript, SCRIPT_STATUS_META, type ScriptWorkflowStatus } from "@/lib/cellumove/script-workflow";

type View = "modules" | "document";

function AutoResizeTextarea({ className = "", onInput, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fitContent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(fitContent, [fitContent, value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      rows={1}
      value={value}
      className={`${className} resize-none overflow-y-hidden`}
      onInput={(event) => {
        fitContent();
        onInput?.(event);
      }}
    />
  );
}

export function ScriptStudioClient({ projectId, initialDocument, initialRevision, initialVersion, initialHandoffVersion, initialStatus, editorName }: { projectId: string; initialDocument: ScriptDocument; initialRevision: number; initialVersion: number; initialHandoffVersion: number | null; initialStatus: ScriptWorkflowStatus; editorName: string | null }) {
  const router = useRouter();
  const [document, setDocument] = useState(initialDocument);
  const [revision, setRevision] = useState(initialRevision);
  const [version, setVersion] = useState(initialVersion);
  const [handoffVersion, setHandoffVersion] = useState(initialHandoffVersion);
  const [status, setStatus] = useState(initialStatus);
  const [view, setView] = useState<View>("modules");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [assistModuleId, setAssistModuleId] = useState<string | null>(null);
  const [assistNotes, setAssistNotes] = useState("");
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistPending, setAssistPending] = useState(false);
  const [hooksPending, setHooksPending] = useState(false);
  // hooksPending (state) only blocks the button once React re-renders it as
  // disabled. This ref blocks synchronously, so a second click that lands
  // before that re-render can't start a concurrent request that would dedupe
  // against a stale document and wrongly report "nothing new" after the first
  // request already added hooks.
  const hooksInFlightRef = useRef(false);
  // Mirrors `document` for async callbacks that need the latest pool AND need to
  // act on the merge result in the same tick. React only runs a setState updater
  // at render time, so anything a callback assigns from inside one is still
  // unset on the next line.
  const documentRef = useRef(document);
  documentRef.current = document;
  const hooksAtCap = document.hookAlternatives.length >= MAX_SCRIPT_HOOK_ALTERNATIVES;
  const issues = useMemo(() => inspectScriptQuality(document), [document]);
  const totalDuration = document.modules.reduce((sum, module) => sum + module.durationSec, 0);
  const editable = canEditScript(status);
  const sendable = canSendScript(status);
  const assistModule = document.modules.find((module) => module.id === assistModuleId) ?? null;

  useEffect(() => {
    if (!assistModuleId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assistPending) setAssistModuleId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [assistModuleId, assistPending]);

  const updateModule = (id: string, patch: Partial<ScriptModule>) => {
    setDocument((current) => ({ ...current, modules: current.modules.map((module) => module.id === id ? { ...module, ...patch } : module) }));
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= document.modules.length) return;
    const modules = [...document.modules];
    const current = modules[index];
    const other = modules[target];
    if (!current || !other) return;
    modules[index] = other;
    modules[target] = current;
    setDocument({ ...document, modules });
  };
  const addModule = () => setDocument((current) => ({ ...current, modules: [...current.modules, { id: `module-${Date.now()}`, kind: "custom", label: "New beat", durationSec: 3, spokenText: "", onScreenText: "", visualDirection: "", brollRefs: [], locked: false, claimFlags: [] }] }));
  const removeModule = (id: string) => {
    if (document.modules.length === 1 || !confirm("Remove this beat?")) return;
    setDocument((current) => ({ ...current, modules: current.modules.filter((module) => module.id !== id) }));
  };
  const openModuleAssist = (moduleId: string) => {
    setAssistModuleId(moduleId);
    setAssistNotes("");
    setAssistError(null);
  };
  const closeModuleAssist = () => {
    if (assistPending) return;
    setAssistModuleId(null);
    setAssistNotes("");
    setAssistError(null);
  };
  const applyModuleAssist = async () => {
    if (!assistModule || assistNotes.trim().length < 2) return;
    const originalLabel = assistModule.label;
    setAssistPending(true);
    setAssistError(null);
    try {
      const result = await assistScriptModule({
        projectId,
        expectedRevision: revision,
        moduleId: assistModule.id,
        notes: assistNotes,
        document,
      });
      setDocument((current) => ({
        ...current,
        modules: current.modules.map((module) => module.id === result.module.id ? result.module : module),
      }));
      setMessage(`AI revised “${originalLabel}”. Review the module, then save your changes.`);
      setAssistModuleId(null);
      setAssistNotes("");
    } catch (error) {
      setAssistError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssistPending(false);
    }
  };
  const save = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveScriptDocument({ projectId, expectedRevision: revision, document });
        setRevision(result.revision);
        setMessage(`Saved revision ${result.revision}.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    });
  };
  const snapshot = () => {
    const summary = prompt("What changed in this version?");
    if (!summary?.trim()) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await snapshotScriptProject({ projectId, changeSummary: summary });
        setVersion(result.version);
        setMessage(`Created version ${result.version}.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    });
  };
  const generateDraft = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await generateScriptProjectDraft({ projectId, expectedRevision: revision, document });
        setDocument(result.document);
        setRevision(result.revision);
        setVersion(result.version);
        setMessage(`AI filled every unlocked module using the project's resources. Created version ${result.version}.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    });
  };
  const applyHook = (hookId: string, text: string) => {
    const hookModule = document.modules.find((module) => module.kind === "hook") ?? document.modules[0];
    if (!hookModule || hookModule.locked) return;
    setDocument((current) => ({
      ...current,
      selectedHookId: hookId,
      modules: current.modules.map((module) => module.id === hookModule.id ? { ...module, spokenText: text } : module),
    }));
  };
  // Plain async like applyModuleAssist, not startTransition, so a slow hook
  // request does not grey out the whole toolbar.
  const requestMoreHooks = async () => {
    if (hooksInFlightRef.current || hooksAtCap) return;
    hooksInFlightRef.current = true;
    setHooksPending(true);
    setMessage(null);
    try {
      const result = await suggestScriptHookAlternatives({ projectId, expectedRevision: revision, document });
      // Re-run against the freshest local pool so ids, dedupe and the cap all
      // account for anything that changed while the request was in flight.
      // result.hooks already passed this same filter server-side, so this pass
      // should normally add all of them unchanged. Merge OUTSIDE the updater:
      // the reported count has to be readable right here, and a setState
      // updater does not run until React renders.
      const merged = appendHookAlternatives(documentRef.current.hookAlternatives, result.hooks);
      const addedCount = merged.added.length;
      if (addedCount > 0) {
        setDocument((current) => ({ ...current, hookAlternatives: [...current.hookAlternatives, ...merged.added] }));
        setMessage(`Added ${addedCount} new hook option${addedCount === 1 ? "" : "s"}. Click Save changes to keep them.`);
      } else if (result.hooks.length > 0) {
        // The server wrote usable hooks but this document already holds them —
        // only reachable if the pool changed under an in-flight request.
        setMessage("Those hook options are already in this script. Try again for a fresh batch.");
      } else if (result.skippedClaimFlagged > 0 && result.skippedDuplicate === 0) {
        setMessage(`All ${result.generatedCount} suggestions were removed by the compliance check (banned words or claims). Try More hooks again — wording varies each request.`);
      } else if (result.skippedClaimFlagged > 0) {
        setMessage(`Of ${result.generatedCount} suggestions, ${result.skippedDuplicate} repeated an existing hook and ${result.skippedClaimFlagged} were removed by the compliance check. Try again for a fresh batch.`);
      } else {
        setMessage("Every suggestion repeated an existing hook, so nothing new was added. Try again for a fresh batch.");
      }
    } catch (error) {
      setMessage(`More hooks could not run: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      hooksInFlightRef.current = false;
      setHooksPending(false);
    }
  };
  const downloadScript = () => {
    const blob = new Blob(["\uFEFF", renderScriptDownload(document)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = scriptDownloadFilename(document);
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const sendToEditor = () => {
    const destination = editorName ? `@${editorName}` : "the unassigned video editor queue";
    if (!confirm(`Send the current script to ${destination}? This creates frozen handoff version ${version + 1}. You can continue editing the working script afterward.`)) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await sendScriptProjectToEditor({ projectId, expectedRevision: revision, document });
        setRevision(result.revision);
        setVersion(result.version);
        setHandoffVersion(result.version);
        setStatus(result.status);
        setMessage(`Version ${result.version} is ready for ${editorName ? `@${editorName}` : "the video editor queue"}. Your working script remains editable.`);
        router.refresh();
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    });
  };

  const statusMeta = SCRIPT_STATUS_META[status];
  const sendLabel = status === "changes_requested"
    ? "Send updated version"
    : status === "ready" && handoffVersion !== null
      ? "Update editor handoff"
      : "Send to video editor";

  return (
    <div className="space-y-4">
      <div className="sticky top-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200/70 bg-white/90 p-3 shadow-card backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2"><div className="rounded-full bg-ink-100 p-1"><button className={`rounded-full px-3 py-1 text-sm ${view === "modules" ? "bg-white shadow-sm" : "text-ink-500"}`} onClick={() => setView("modules")}>Modules</button><button className={`rounded-full px-3 py-1 text-sm ${view === "document" ? "bg-white shadow-sm" : "text-ink-500"}`} onClick={() => setView("document")}>Document</button></div><span className={statusMeta.className}>{statusMeta.label}</span><span className="text-xs text-ink-500">{totalDuration}s / {document.targetDurationSec}s · {issues.length} checks</span></div>
        <div className="flex flex-wrap gap-2"><button className="btn" onClick={generateDraft} disabled={pending || hooksPending || !editable}>{pending ? "Generating…" : "AI fill all"}</button><button className="btn" onClick={downloadScript}>Download script</button><button className="btn" onClick={snapshot} disabled={pending || !editable}>Create version</button><button className="btn" onClick={save} disabled={pending || !editable}>{pending ? "Working…" : "Save changes"}</button><button className="btn btn-primary" onClick={sendToEditor} disabled={pending || !sendable}>{sendLabel}</button></div>
      </div>
      {message && <div className={`rounded-lg border p-3 text-sm ${/changed|error|could not/i.test(message) ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>{message}</div>}
      {handoffVersion !== null && <div className="rounded-xl border border-brand-purple/20 bg-brand-purple/5 px-4 py-3 text-sm text-ink-700"><span className="font-semibold">Video editor handoff is frozen at version {handoffVersion}.</span> Your working script remains editable. Saved changes do not alter the video editor's copy until you explicitly send an updated handoff.</div>}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">AI hook options</h2><p className="text-xs text-ink-500">Apply an option to the hook module, then edit it normally.</p></div>
          <button type="button" className="btn" disabled={!editable || pending || assistPending || hooksPending || hooksAtCap} onClick={requestMoreHooks}>{hooksPending ? "Writing hooks…" : hooksAtCap ? "Hook limit reached" : "More hooks"}</button>
        </div>
        {document.hookAlternatives.length > 0
          ? <div className="grid gap-2 lg:grid-cols-3">{document.hookAlternatives.map((hook) => <button key={hook.id} type="button" disabled={!editable} className={`rounded-xl border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${document.selectedHookId === hook.id ? "border-brand-purple bg-brand-purple/5" : "border-ink-200 hover:border-ink-400"}`} onClick={() => applyHook(hook.id, hook.text)}>{hook.text}</button>)}</div>
          : <p className="text-xs text-ink-500">No hook options yet. Use More hooks, or AI fill all for a complete draft.</p>}
      </section>

      {view === "modules" ? (
        <div className="space-y-3">
          {document.modules.map((module, index) => {
            const moduleIssues = issues.filter((issue) => issue.moduleId === module.id);
            return <section key={module.id} className={`card space-y-3 ${module.locked ? "bg-ink-50" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs text-white">{index + 1}</span><input aria-label="Beat label" className="input max-w-xs font-semibold" value={module.label} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { label: event.target.value })} /><span className="tag">{module.kind}</span></div><div className="flex flex-wrap gap-1"><button className="btn btn-ghost" disabled={!editable || module.locked || pending || assistPending} onClick={() => openModuleAssist(module.id)}>AI Assist</button><button className="btn btn-ghost px-2" onClick={() => move(index, -1)} disabled={!editable || index === 0}>↑</button><button className="btn btn-ghost px-2" onClick={() => move(index, 1)} disabled={!editable || index === document.modules.length - 1}>↓</button><button className="btn btn-ghost" disabled={!editable} onClick={() => updateModule(module.id, { locked: !module.locked })}>{module.locked ? "Unlock" : "Lock"}</button><button className="btn btn-ghost text-red-700" disabled={!editable} onClick={() => removeModule(module.id)}>Remove</button></div></div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_8rem]"><div><label className="label">Spoken copy</label><AutoResizeTextarea className="input min-h-11" value={module.spokenText} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { spokenText: event.target.value })} /></div><div><label className="label">Visual direction</label><AutoResizeTextarea className="input min-h-11" value={module.visualDirection} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { visualDirection: event.target.value })} /></div><div><label className="label">Seconds</label><input className="input" type="number" min={0} max={600} value={module.durationSec} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { durationSec: Number(event.target.value) })} /></div></div>
              <div><label className="label">On-screen text</label><input className="input" value={module.onScreenText} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { onScreenText: event.target.value })} /></div>
              {module.brollRefs.length > 0 && <div><div className="label">Matched B-roll</div><div className="flex flex-wrap gap-2">{module.brollRefs.map((clip) => clip.url ? <a key={`${module.id}-${clip.clipId}`} className="tag hover:underline" href={clip.url} target="_blank" rel="noreferrer">{clip.name} ↗</a> : <span key={`${module.id}-${clip.clipId}`} className="tag">{clip.name}</span>)}</div></div>}
              {moduleIssues.length > 0 && <ul className="space-y-1">{moduleIssues.map((issue, issueIndex) => <li key={`${issue.message}-${issueIndex}`} className={`text-xs ${issue.severity === "error" ? "text-red-700" : "text-amber-700"}`}>{issue.severity === "error" ? "⚠" : "•"} {issue.message}</li>)}</ul>}
            </section>;
          })}
          <button className="btn w-full border-dashed" disabled={!editable} onClick={addModule}>+ Add beat</button>
        </div>
      ) : (
        <section className="card mx-auto max-w-4xl space-y-6 p-6 sm:p-10">
          <div><p className="label">Continuous document · same canonical modules</p><h2 className="text-xl font-semibold">{document.title}</h2><p className="mt-1 text-sm text-ink-500">{document.product.name} · {document.angle.name} · {document.format}</p></div>
          {document.modules.map((module, index) => <div key={module.id} className="grid grid-cols-[5.5rem_1fr] gap-4 border-t border-ink-200 pt-5"><div className="space-y-2 text-xs text-ink-500"><div>{index + 1}. {module.label}</div><div>{module.durationSec}s</div><button className="btn btn-ghost h-8 px-2 text-xs" disabled={!editable || module.locked || pending || assistPending} onClick={() => openModuleAssist(module.id)}>AI Assist</button></div><div className="space-y-3"><AutoResizeTextarea aria-label={`${module.label} spoken copy`} className="min-h-7 w-full bg-transparent text-base leading-7 outline-none placeholder:text-ink-300" placeholder="Spoken copy…" value={module.spokenText} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { spokenText: event.target.value })} /><input aria-label={`${module.label} on-screen text`} className="w-full border-l-2 border-brand-pink/40 bg-transparent pl-3 text-sm font-medium outline-none" placeholder="On-screen text…" value={module.onScreenText} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { onScreenText: event.target.value })} /><AutoResizeTextarea aria-label={`${module.label} visual direction`} className="min-h-10 w-full bg-ink-50 p-3 text-sm leading-6 text-ink-600 outline-none" placeholder="Visual direction…" value={module.visualDirection} disabled={!editable || module.locked} onChange={(event) => updateModule(module.id, { visualDirection: event.target.value })} /></div></div>)}
        </section>
      )}
      {assistModule && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModuleAssist(); }}><section role="dialog" aria-modal="true" aria-labelledby="module-assist-title" className="w-full max-w-2xl rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="label">Module AI Assist</p><h2 id="module-assist-title" className="text-xl font-semibold">Revise “{assistModule.label}”</h2><p className="mt-1 text-sm text-ink-500">Describe what should change. AI will update only this module and preserve its matched B-roll.</p></div><button type="button" className="btn btn-ghost px-3" aria-label="Close AI Assist" disabled={assistPending} onClick={closeModuleAssist}>×</button></div><div className="mt-5"><label className="label" htmlFor="module-assist-notes">Change notes</label><textarea id="module-assist-notes" className="input min-h-36" autoFocus placeholder="Example: Make the spoken copy more conversational, remove repeated filler, and show the compression fabric in use." value={assistNotes} disabled={assistPending} onChange={(event) => setAssistNotes(event.target.value)} /></div>{assistError && <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{assistError}</div>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-400">The rewrite is not saved until you click Save changes.</p><div className="flex gap-2"><button type="button" className="btn" disabled={assistPending} onClick={closeModuleAssist}>Cancel</button><button type="button" className="btn btn-primary" disabled={assistPending || assistNotes.trim().length < 2} onClick={applyModuleAssist}>{assistPending ? "Revising module…" : "Apply AI changes"}</button></div></div></section></div>}
      {issues.some((issue) => issue.moduleId === "document") && <div className="card border-amber-300 bg-amber-50"><h3 className="text-sm font-semibold text-amber-900">Document checks</h3>{issues.filter((issue) => issue.moduleId === "document").map((issue) => <p key={issue.message} className="mt-1 text-sm text-amber-800">{issue.message}</p>)}</div>}
      <p className="text-xs text-ink-400">Working revision {revision} · named version {version}. Locked modules remain editable only after unlocking.</p>
    </div>
  );
}
