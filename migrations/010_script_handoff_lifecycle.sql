-- Migration 010: explicit Script Studio handoff lifecycle.
-- Existing installations used `review` for ready and `assigned` for claimed.
-- Keep those legacy values valid so deployments can roll forward without downtime.

alter table "ScriptProject" drop constraint if exists "ScriptProject_status_check";
alter table "ScriptProject"
  add constraint "ScriptProject_status_check"
  check (status in (
    'draft', 'generating', 'review', 'ready', 'assigned', 'claimed', 'available',
    'submitted', 'changes_requested', 'approved'
  ));

alter table "ScriptAssignment" drop constraint if exists "ScriptAssignment_status_check";
alter table "ScriptAssignment"
  add constraint "ScriptAssignment_status_check"
  check (status in (
    'available', 'assigned', 'ready', 'claimed', 'submitted',
    'changes_requested', 'approved'
  ));

