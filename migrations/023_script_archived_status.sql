-- Migration 023: batch cherry-picking discards drafts by ARCHIVING them —
-- recoverable, keeps usage receipts and events — never by deleting. Adds the
-- 'archived' status to ScriptProject (assignment statuses unchanged). Idempotent.

alter table "ScriptProject" drop constraint if exists "ScriptProject_status_check";
alter table "ScriptProject"
  add constraint "ScriptProject_status_check"
  check (status in (
    'draft', 'generating', 'review', 'ready', 'assigned', 'claimed', 'available',
    'submitted', 'changes_requested', 'approved', 'archived'
  ));
