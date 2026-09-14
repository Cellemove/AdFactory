-- Migration 020: winners are selected manually — performance metrics are
-- optional extra detail, not a requirement. Drops the table-level check from
-- migration 017 that forced performanceEvidence on verified_winner rows
-- (the app-level validation was removed in the same change). Idempotent.

alter table "ScriptEvidence" drop constraint if exists "ScriptEvidence_check";
