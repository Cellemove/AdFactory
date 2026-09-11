-- Migration 021: ads join the corpus only when a corpus pull says so.
--
-- /spy saves every ad it shows into "CompetitorAd". With the old default
-- (true), each Spy refresh quietly added its ads to the Corpus Miner's picked
-- winners set. Now new rows start outside the corpus; miner:winners and
-- miner:ingest set "corpusIncluded" = true explicitly. Existing rows are
-- untouched. Idempotent: safe to re-run.

alter table "CompetitorAd" alter column "corpusIncluded" set default false;
