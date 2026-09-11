-- Milanote boards carry an AI "Deconstruction of the ads" column beside the final
-- script. Keep it on the evidence record as its own field so it never leaks into
-- "Exact script text" but is still available to reviewers and the scorer.
alter table "ScriptEvidence" add column if not exists "deconstructionText" text;
