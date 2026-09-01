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
  ready: { label: "Ready for editor", className: "tag tag-warn" },
  claimed: { label: "Claimed", className: "tag tag-warn" },
  submitted: { label: "Submitted", className: "tag tag-ok" },
  changes_requested: { label: "Changes requested", className: "tag tag-danger" },
  approved: { label: "Approved", className: "tag tag-ok" },
};

export function normalizeScriptWorkflowStatus(
  projectStatus: string,
  assignmentStatus?: string | null,
): ScriptWorkflowStatus {
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
  return status === "draft" || status === "changes_requested";
}

export function canSendScript(status: ScriptWorkflowStatus): boolean {
  return status === "draft" || status === "changes_requested";
}

export function canClaimScript(status: ScriptWorkflowStatus): boolean {
  return status === "ready";
}

