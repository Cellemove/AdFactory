export const SCRIPT_WORKFLOW_STATUSES = [
  "draft",
  "ready",
  "claimed",
  "submitted",
  "changes_requested",
  "approved",
] as const;

export type ScriptWorkflowStatus = (typeof SCRIPT_WORKFLOW_STATUSES)[number];

export const SCRIPT_STATUS_META: Record<ScriptWorkflowStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "tag" },
  ready: { label: "Ready for video editor", className: "tag tag-warn" },
  claimed: { label: "Claimed", className: "tag tag-warn" },
  submitted: { label: "Submitted", className: "tag tag-ok" },
  changes_requested: { label: "Changes requested", className: "tag tag-danger" },
  approved: { label: "Approved", className: "tag tag-ok" },
};

export function normalizeScriptWorkflowStatus(
  projectStatus: string,
  assignmentStatus?: string | null,
): ScriptWorkflowStatus {
  // A video editor may be selected while the strategist is still authoring.
  // Assignment alone must not publish or lock a draft.
  if (projectStatus === "draft" || projectStatus === "generating") return "draft";
  if (assignmentStatus === "claimed") return "claimed";
  if (assignmentStatus === "submitted") return "submitted";
  if (assignmentStatus === "changes_requested") return "changes_requested";
  if (assignmentStatus === "approved") return "approved";
  if (["ready", "available", "assigned"].includes(assignmentStatus ?? "")) return "ready";

  if (projectStatus === "review") return "ready";
  if (projectStatus === "assigned") return "claimed";
  if (SCRIPT_WORKFLOW_STATUSES.includes(projectStatus as ScriptWorkflowStatus)) {
    return projectStatus as ScriptWorkflowStatus;
  }
  return "draft";
}

export function canEditScript(status: ScriptWorkflowStatus): boolean {
  // Script authorship belongs to Creative Strategists. The workflow status
  // controls the frozen video-editor handoff, not the strategist's live draft.
  return SCRIPT_WORKFLOW_STATUSES.includes(status);
}

export function canSendScript(status: ScriptWorkflowStatus): boolean {
  return status === "draft" || status === "ready" || status === "changes_requested";
}

export function canClaimScript(status: ScriptWorkflowStatus): boolean {
  return status === "ready";
}

