# Corpus Miner

Product A of the Copy Engine: competitor ads → durable media → two-channel transcripts (voiceover + on-screen text) → closed-taxonomy beats behind an evidence gate → mined patterns. Nothing here generates copy. The Scorer's `GoldAd`/`GoldBeat` cohort logic is the eventual consumer.

Architecture rule: **structure comes from the data, the model only fills fixed slots**. The runners are plain scripts with one model call per ad per stage (a second only when validation fails, then quarantine). No agent loop.

## Setup

1. Apply `migrations/017_corpus_miner.sql` through `023_corpus_visuals_and_playbook.sql` in order (Supabase SQL editor or MCP `apply_migration`).
2. `.env` needs `BRANDSEARCH_API_KEY`, the Supabase service-role values, and Vertex credentials (`GOOGLE_CLOUD_PROJECT` + ADC or `GOOGLE_APPLICATION_CREDENTIALS_JSON`). Optional: `CORPUS_TAXONOMY_VERSION`, `CORPUS_TRANSCRIBE_MODEL`, `CORPUS_EXTRACT_MODEL`. `miner:teardown` needs `TEARDOWN_API_BASE_URL` pointing at the live Teardown API (`https://teardown-api-67886675912.us-central1.run.app/api/v1`); it only uses Teardown's public endpoints, so no token.
3. Downloaded videos live in the private Supabase Storage bucket `corpus-media` at `<adId>/<sha256>.<ext>` (`AdMedia.storagePath`; the hash is re-verified on every read). One copy is shared by the CLI, local dev and the deployed app.

## Commands

| Command | Stage | Notes |
|---|---|---|
| `npm run miner:winners` | INGEST (winners) | **The corpus.** ~100 winners spread evenly across every Spectre competitor: videos still running 21+ days after launch, newest launch first (so a re-run brings in new survivors and drops the oldest, keeping the count). Short brands are topped up from brands with more; the pick becomes the corpus (`corpusIncluded`, `winnerPick`) and other ads are kept but excluded. ~1 BrandSearch credit per ad. `--limit N`, `--min-days N`, `--dry-run` (still spends credits), `--no-media`. |
| `npm run miner:ingest` | INGEST | Spectre competitors, 25 ads/brand, ended ads included. **1 BrandSearch credit per row.** Chains the media download because links die after 3 days. `--dry-run`, `--per-brand N`, `--status active`, `--no-media`. |
| `npm run miner:media` | MEDIA | Downloads what is not yet on disk. `--limit`, `--ad id`, `--brand name`, `--force`. |
| `npm run miner:transcribe` | TRANSCRIBE | Gemini reads the video: `vo` + `ost` segments. Idempotent by (ad, media hash, prompt, model). |
| `npm run miner:extract` | EXTRACT | Beats from the closed taxonomy. Refuses until Gate 1 has passed; `--skip-gate` overrides loudly. `--with-video` attaches the video too. `--retry-review` re-runs quarantined ads. |
| `npm run miner:score` | — | winnerScore, a longevity ranking. Pure arithmetic. |
| `npm run miner:mine` | MINE | Frequency, positional laws, PrefixSpan spines, quartile lift, layer durations. One snapshot per cohort; unchanged corpus = no write. |
| `npm run miner:playbook -- --brand X` | PLAYBOOK | One competitor's playbook from its extracted ads: the spine with typical windows, hooks, the beat library with real lines + on-screen text + the shot, formats and concepts, and the copywriting rules it follows (each with the share of ads and proofs). Free, statistics only. Snapshot in `CorpusBrandPlaybook`; unchanged corpus = no write. Shown at `/miner/playbook`. |
| `npm run miner:teardown` | TEARDOWN | Top-quartile winners (by winnerScore, recomputed first) → Teardown's 14-part workbook → `AdTeardown`. Skips completed, retries failed, waits for results. `--dry-run` (list + est. cost), `--limit N`, `--ad id --force`, `--no-wait`. **~$0.15–0.20 per video** (Gemini 2.5 Pro via Teardown). Not part of `miner:run`. |
| `npm run miner:run` | all | In order, with `--until <stage>`. |
| `npm run miner:eval` | Gate 1 | Production extractor, blind, over the gold set. Logged to `CorpusEvalRun`. |
| `npm run miner:dump-ad -- <id> [--run-missing] [--out file]` | — | **The first deliverable**: one ad end to end as JSON. |
| `npm run miner:seed-taxonomy -- --version copy-taxonomy-v2 [--commit]` | — | Seeds a taxonomy version; never mutates an existing one. |
| `npm run test:corpus` | — | Unit tests for the pure modules. |

**In the app:** `/miner` is the Run pipeline page - pick a competitor from the brand rail, then **Run everything** chains collect, download, transcribe, beats, rank and patterns for that brand (creative strategists only). One request per ad, a few in parallel, with live per-ad results; it calls the same code as the CLI and shares the "what's ready" rule (`corpus/queue.ts`), so `npm run miner:run -- --brand X --skip-gate` is its headless twin. Closing the tab stops after the ads in flight, and Run picks up where it left off. Teardown stays a separate, paid button. `/miner/results` shows the pattern report, the review queue, failures and the corpus table; each ad page has **Download JSON** (the first deliverable).

## First deliverable

```powershell
npm run miner:dump-ad -- <competitorAdId> --run-missing --out corpus-media/first-ad.json
```

Compare `beats[]` (each with `evidenceQuote`, `matchScore`, `startSec`/`endSec`, `matchedSegmentId`) against the hand decomposition of the same ad. If it matches, the rest of the corpus is a loop. If it does not, nothing downstream matters.

## Taxonomy and Gate 1

- The extractor runs against `copy-taxonomy-v2` (48 codes): the named beats from the strategist's own script board (hyper-dated pain, reattribution, category execution, quantified mechanism, skepticism inoculation, time ladder, witness, guarantee in the story's words, offer with a reason-why) plus the hook types the Teardown workbook classifies by, one OTHER per layer, and a global OTHER. Seeds live in `src/lib/cellumove/corpus/taxonomy-seeds.ts`; `copy-taxonomy-v1` (nine placeholders) is kept only so older beats stay interpretable.
- The extractor also tags each ad's **format** (`CompetitorAd.formatTag`, from the Script Studio list) and **concept** (`angleTag`, a closed list of eleven big ideas such as "Hidden cause" or "Tried everything"). MINE groups by both; a manual tag always beats the model's.
- Transcripts carry three channels: `vo` (spoken), `ost` (on-screen text) and `vis` (what is on screen shot by shot, with the editing cue). Beats may only quote `vo`/`ost`; `vis` is context for the extractor and the visual line in the playbook.
- Gate 1 still needs the 35 hand-labelled ads: import them with `npm run scorer:import-gold -- gold.json --taxonomy copy-taxonomy-v2 --baseline gold-35-v2 --commit`, then `npm run miner:eval --baseline gold-35-v2 --taxonomy copy-taxonomy-v2` must report >=0.80 layer and >=0.70 code agreement before beats are trusted. Until then the Run page asks you to tick "the beat labels are provisional". Every eval run is logged with its prompt version; a prompt change means bumping `CORPUS_EXTRACT_PROMPT_VERSION` (now v2) or `CORPUS_TRANSCRIBE_PROMPT_VERSION` (now v2) in `constants.ts` and re-running.

## The playbook

The end product per competitor, in the shape of the strategist's script board. Built by `buildPlaybook` (`corpus/playbook.ts`, pure) from the brand's beats, transcript lines and visual notes plus its mined pattern report:

- **Spine** - the brand's most common beat sequence, each step with its typical window in seconds.
- **Hooks** and the **beat library** - every code the brand uses with share of ads, median start and length, and up to three real examples: the quoted line, the on-screen text at that moment, and the shot.
- **Copywriting rules** (`corpus/copy-rules.ts`) - tone stats (sentence length, "you" vs "I", question openers, caption style) and rules the brand follows in >=50% of ads (opens on pain, dated pain, failed alternatives before the product, a number in the proof, time ladder, skepticism inoculation, clean guarantee, soft vs hard CTA, captions echoing the voiceover, ALL-CAPS captions, swearing, witness), each with the share and three proofs. Counted, never written by a model.
- **Formats & concepts** - shares from the extractor's tags.
- **Laws** - the mined order rules in plain words.

## Provenance

Every row carries what produced it: `CorpusTranscriptRun.promptVersion`, `CorpusExtractRun.{taxonomyVersion, extractorPromptVersion, engineVersion, model, withVideo}`, `AdBeat.{extractorPromptVersion, model, matchScore, matchedSegmentId}`, `CorpusPatternReport.inputHash`, `CompetitorAd.winnerScoreVersion`. Model calls are also in the `Usage` table under `corpus_transcribe`, `corpus_extract`, `corpus_eval`.

## Known limits

- Videos over 15 MB cannot be sent inline to Vertex; the SD rendition is tried first, otherwise the ad is marked `oversize`. A GCS bucket + `fileData.fileUri` would lift that.
- Gemini timestamps are roughly ±1 s; the gate tolerates that and the duration stats should not be read finer than a second.
- On-screen text can be misread. Captions are deduped to first appearance, carry a confidence, and the voiceover channel is cross-checked against BrandSearch's transcript where one exists.
- `winnerScore` is a ranking proxy (days active heaviest, then variants, placements, concept reuse). It is labelled as such everywhere and must not be read as ROAS.
- The corpus is multilingual; prompts forbid translation. Compare within a format or brand cohort before drawing cross-language conclusions.

## Daily recent winners and manual Spy batches

`npm run miner:recent -- --dry-run` fetches active videos launched 7–30 UTC calendar days ago, ranked by EU spend and spread across tracked Spectre competitors. This is a performance proxy, not BrandSearch's private Winning Creative badge or proof of ROAS. The original 21-day corpus and Spy feed selection are unchanged.

The job first syncs pending Teardown workbooks, then subtracts all AdTeardown rows submitted since UTC midnight from `RECENT_WINNERS_DAILY_CAP` (default 10, clamped 0–10). Manual/corpus submissions and retries consume this allowance too. At the cap it returns before fetching BrandSearch ads. `0` disables new work while retaining sync. Invalid nonnumeric configuration fails rather than silently spending credits.

The pool targets four times the cap; approximately 40–50 BrandSearch credits/day (about 1.2–1.5k/month), depending on brand availability and pagination. A dry run prints candidates, launch dates and quota remaining; it submits no new jobs, but **does sync existing results** and spends BrandSearch credits. Every ad with an existing AdTeardown row is excluded, including failed jobs. Failed jobs can be retried manually. Only ads actually started are indexed. Upserts omit corpusIncluded and winnerPick, preserving corpus membership.

`npm run miner:recent -- --limit 1` sets the total daily allowance to one, not one additional job. A sequential rerun returns "Day cap reached" with zero BrandSearch credits once that allowance is used. Three submission lanes stop starting ads after 450 seconds; accepted jobs finish asynchronously in Teardown. Typical workbook cost is about $0.20/video, taking 2–4 minutes.

On `/spy`, creative strategists can select up to ten indexed video tiles and confirm the estimated cost before submitting. Queued/processing/completed ads cannot be selected. Pending jobs sync every 15 seconds while the page is open; closing it stops further submissions after in-flight requests. Expired links without a stored copy show a refresh instruction. Older cached feeds acquire selection IDs on their next refresh (up to three days). Images are unsupported. The latest 20 submissions appear under **Recently deconstructed**, including recent winners outside the gallery's 21-day rule. Their `/miner/[adId]` pages and Script Studio's existing Teardown2 source picker work without corpus membership; the source picker shows only the latest 100 completed workbooks.

### Production setup

- `vercel.json` schedules `/api/cron/recent-winners` daily at **04:00 UTC / 12:00 Singapore**, production only.
- Configure `CRON_SECRET` (random secret) and `RECENT_WINNERS_DAILY_CAP=10` in Vercel Production, alongside existing BrandSearch, Supabase and classic Teardown credentials. Deploy to activate the schedule.
- The route fails closed with HTTP 401 for missing/wrong bearer tokens or an unset secret. Middleware exempts `/api/cron/` so cron receives 401 instead of a login redirect. It has no interactive-user authentication; the bearer secret is mandatory.
- Verify the project's actual function-duration support: the route requests 600 seconds; an existing export is not proof of plan eligibility. If restricted to 300 seconds, change maxDuration to 300 and budgetMs to 170_000; optionally add a second run at 05:00 UTC. See https://vercel.com/docs/functions/configuring-functions/duration.
- After deployment, verify no/wrong/right authorization produces 401/401/200, inspect the Cron tab the following morning, and check the `[recent-winners]` JSON summary in logs. A correctly authorized request can submit paid jobs.

### Known boundaries

The read-before-submit guard and UTC count protect sequential reruns, not simultaneous cron/manual calls. There is no atomic claim or distributed lock; overlapping invocations can duplicate submissions or exceed the daily allowance. A Teardown POST timeout after remote acceptance can leave an orphan with no local row. Add durable claims/idempotency and orphan recovery before increasing schedule frequency. Stored-copy uploads also have longer timeouts than URL submissions, so the 450-second start budget is not a hard end-to-end deadline. No schema migration or automatic failure retry is introduced.

### Verification (2026-09-18)

- Passed typecheck, lint, production build, 59 corpus tests, 10 BrandSearch tests, and `npm run test:recent-winners` (runner/adapter/cron guard tests with a closed mock network).
- Live BrandSearch lower-bound check: HTTP 200, one credit. Recent dry run: 41 credits, ten candidates across ten competitors, all inside the UTC date window.
- Live `--limit 1`: one matching local/remote Teardown record, corpusIncluded=false, winnerPick=null; corpus count remained 103. Sequential rerun: day cap reached, zero provider credits.
- Browser: feed Refresh, video checkboxes, $0.40 two-selection estimate, three-lane batch results, missing-link skip, status polling, ten-selection limit, completed badge/detail link, and Script Studio source visibility verified. Three live verification workbooks completed (one automatic and two manual).
- Local HTTP cron checks: missing/wrong/valid bearer returned 401/401/200 (valid test used cap=0). Completed-ad POST returned "Already deconstructed" without resubmission.
- Not deployed by this change. Production environment variables, the actual Vercel duration limit, deployed auth checks, and next-day Cron execution remain deployment checks.
