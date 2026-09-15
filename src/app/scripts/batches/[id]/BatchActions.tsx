"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveScriptProject, sendScriptToEditorById } from "@/app/actions/scripts";
import type { ScriptWorkflowStatus } from "@/lib/cellumove/script-workflow";

// Cherry-pick controls on a batch card. Keep = the draft enters the normal
// ready→claim→review flow; Discard = archive (recoverable, draft-only).
export function BatchActions({ projectId, status }: { projectId: string; status: ScriptWorkflowStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => startTransition(async () => {
    setError(null);
    try { await action(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });

  return <div className="flex flex-wrap items-center gap-2">
    {status === "draft" && (
      <>
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => sendScriptToEditorById(projectId))}>
          {pending ? "Working…" : "Send to editor"}
        </button>
        <button
          type="button"
          className="btn btn-ghost text-red-700"
          disabled={pending}
          onClick={() => { if (window.confirm("Discard this draft? It is archived (recoverable), not deleted.")) run(() => archiveScriptProject(projectId)); }}
        >
          Discard
        </button>
      </>
    )}
    {error && <span className="text-xs text-red-700">{error}</span>}
  </div>;
}
