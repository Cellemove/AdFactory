"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignScriptProjectToEditor } from "@/app/actions/scripts";

type EditorOption = { id: string; username: string };

export function AssignEditorControl({
  projectId,
  editors,
  compact = false,
}: {
  projectId: string;
  editors: EditorOption[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [editorUserId, setEditorUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const assign = () => {
    if (!editorUserId) return;
    setError(null);
    startTransition(async () => {
      try {
        await assignScriptProjectToEditor({ projectId, editorUserId });
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  if (!editors.length) {
    return <span className="text-xs text-amber-700">No Editor accounts</span>;
  }

  return (
    <div className={compact ? "min-w-56" : "min-w-64"}>
      <div className="flex items-center gap-2">
        <select
          aria-label="Editor to assign"
          className={`input ${compact ? "h-9 py-1 text-xs" : "h-10 py-1 text-sm"}`}
          value={editorUserId}
          disabled={pending}
          onChange={(event) => setEditorUserId(event.target.value)}
        >
          <option value="">Choose editor…</option>
          {editors.map((editor) => <option key={editor.id} value={editor.id}>@{editor.username}</option>)}
        </select>
        <button type="button" className={`btn btn-primary ${compact ? "h-9 px-3 text-xs" : "h-10"}`} disabled={pending || !editorUserId} onClick={assign}>
          {pending ? "Assigning…" : "Assign"}
        </button>
      </div>
      {error && <p className="mt-1 text-left text-xs text-red-700">{error}</p>}
    </div>
  );
}
