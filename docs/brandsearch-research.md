# BrandSearch-first research

Enable `BRANDSEARCH_RESEARCH_ENABLED=true` **after applying
`migrations/026_brandsearch_research.sql`**. The default is disabled. This flag
switches daily recent-winner work and the default corpus mode to speech research.
It also exposes research import/review in Spy and reference selection in Script
Studio. Disabling it restores the previous default; saved snapshots remain usable
by existing projects. No Teardown2 deployment is required.

## Workflow

1. Import listing body, headline and CTA as separate copy fields.
2. GET `/v1/meta-ads/{ad_id}/transcription` and `/ai-analysis`, regardless of whether
   the listing has a transcript URL. Missing/expired video does not block this.
3. If speech is missing, claim the shared budget and POST transcription with
   `force_regenerate: false`. There is no AI-analysis POST in this workflow.
4. Save an immutable source snapshot and a durable job status. A valid no-speech
   response is `empty`; missing, malformed and failed responses remain distinct.
5. Corpus members can import those segments as `vo` without a media row, then run
   text-only beat extraction. Speech-only extraction has its own prompt/evaluation
   version. Full-video evaluation results do not approve it automatically.
6. Pattern reports and brand playbooks have separate speech-only version keys.
   They use one extraction per ad, within the selected coverage mode. Caption
   metrics are **unassessed**, never zero merely because video was not examined.
7. In Spy, review the imported research, then use it as a Script Studio reference.
   A project selects either that immutable snapshot or a Teardown record. Both
   creation and regeneration use the pinned snapshot; competitor material is
   strategy context and is never added to the approved product-evidence pool.

## Spending and recovery

- Existing-data GETs use no regular API credits. Candidate-list queries retain
  their existing charges. New speech requests each reserve one of ten slots per
  UTC day, shared by cron, Spy and corpus imports. Existing corpus text-model
  extraction costs still apply.
- PostgreSQL functions enforce the budget and per-ad ownership. Their execute
  grants are restricted to `service_role`. The budget is intentionally
  conservative: a failed/uncertain attempt still occupies that day's slot.
- An ambiguous POST timeout/crash remains `uncertain`. Subsequent attempts first
  GET the transcript and never automatically POST again while uncertain. A known
  rejection can be retried on a later UTC day. To resolve an indefinitely
  uncertain request, confirm its state with BrandSearch before changing the
  request ledger; do not delete reservations to force a retry.
- BrandSearch charges a credit only when a POST succeeds, and a POST that returns
  an already-generated transcript (`generated: false`) is recorded as zero credits.
  `ad_not_found`, `ad_not_video` and `transcript_unavailable` are permanent: the
  job waits 30 days instead of an hour, so it cannot crowd the ten-job recovery
  window. An explicit refresh re-checks it sooner.
- Jobs release their lease after completion; interrupted jobs can be claimed
  after ten minutes. Deferred/error jobs are eligible again after one hour. The
  daily cron reconciles due jobs before selecting new research. A manual run also
  resumes due jobs. Provider generation can take six minutes, so the cron stops
  starting work when insufficient time remains.
- The daily ten-ad selection cap and the global ten-transcript spending cap are
  separate. Existing deferred jobs are recovery work, not new daily picks. Setting
  `RECENT_WINNERS_DAILY_CAP=0` disables automatic research and recovery while still
  synchronizing already-submitted Teardown jobs.

## Full-video mode and CLI

Choose **Full video analysis** on `/miner` to retain video download, multimodal
transcription and full-evidence reports. Full deconstruction in Spy retains the
existing Teardown workflow. Neither happens automatically in speech mode.

Three consumers deliberately do not follow the flag. The Script Studio Structure
scorer and `miner:formats` read full-video extractions only, because both match on
production format, which speech-only runs never carry. The `/miner/<ad>` page and
the JSON export show the default mode's evidence and fall back to the other mode,
so an ad's existing full breakdown stays visible after the flag is enabled.

With the feature flag enabled, `miner:run`, `miner:transcribe`, `miner:extract`,
`miner:mine`, `miner:playbook`, and `miner:eval` default to speech-only mode.
Pass `--full-video` for the previous behavior. `--with-video` also selects full
mode. `--force` never forces a paid BrandSearch regeneration.

## Verification and rollout

Run `npm run test:brandsearch-research`, `npm run test:recent-winners`,
`npm run test:corpus`, relevant Script Studio tests, `npm run typecheck`, and
`npm run build`. Budget tests execute the actual migration/functions in PGlite;
this is a single-connection PostgreSQL runtime, not a distributed production
concurrency test. HTTP integration tests use a closed mock network and purchase
no transcripts or model results.

Apply the migration before deploying the code — **even with the flag off**. The
corpus loaders always filter on the new `source` and `researchMode` columns, so
`/miner` fails against a database without migration 026. As of 2026-09-22 it had
not been applied to production.

A read-only check on 2026-09-22 (15 video ads, 15 brands, free GETs) found 12
cached transcripts, 2 needing generation and 1 transient 503, but cached AI
analysis for only 4. Expect provider interpretation to be absent for most ads;
none of the 339 stored video ads has a listing transcript URL. Then enable the flag in a test
environment, import a cached ad, review its speech/coverage, select it in Script
Studio, and run an included corpus ad through extraction and the speech-only
playbook. Verify that full-video results remain selectable. Enable production
after that smoke test. Monitor `brandsearch_research` Usage entries (cache use,
transcript credits, provider status, deferred jobs), `AdResearchJob`, the request
ledger, extraction quarantine counts, and per-mode report coverage.

Source: [BrandSearch Ads API](https://docs.brandsearch.co/ads).
