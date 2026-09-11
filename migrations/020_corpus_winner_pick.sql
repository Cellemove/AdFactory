-- Migration 020: the corpus becomes a picked set of competitor winners.
--
-- "Collect winners" (miner:winners, or step 1 on /miner/run) pulls ~100 ads
-- spread across every Spectre competitor: videos still running weeks after
-- launch, highest spend first. The picked ads are the corpus
-- ("corpusIncluded" = true); everything else is kept but excluded. This column
-- records why an ad is in: the rule and its version, the ad's rank within its
-- brand, and when it was picked. Null = not in the current pick.
-- Idempotent: safe to re-run.

alter table "CompetitorAd" add column if not exists "winnerPick" jsonb;
