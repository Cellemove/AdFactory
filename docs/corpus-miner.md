# Corpus Miner

Product A of the Copy Engine: competitor ads → durable media → two-channel transcripts (voiceover + on-screen text) → closed-taxonomy beats behind an evidence gate → mined patterns. Nothing here generates copy. The Scorer's `GoldAd`/`GoldBeat` cohort logic is the eventual consumer.

Architecture rule: **structure comes from the data, the model only fills fixed slots**. The runners are plain scripts with one model call per ad per stage (a second only when validation fails, then quarantine). No agent loop.

## Setup

1. Apply `migrations/017_corpus_miner.sql` through `021_corpus_opt_in.sql` in order (Supabase SQL editor or MCP `apply_migration`).
2. `.env` needs `BRANDSEARCH_API_KEY`, the Supabase service-role values, and Vertex credentials (`GOOGLE_CLOUD_PROJECT` + ADC or `GOOGLE_APPLICATION_CREDENTIALS_JSON`). Optional: `CORPUS_TAXONOMY_VERSION`, `CORPUS_TRANSCRIBE_MODEL`, `CORPUS_EXTRACT_MODEL`. `miner:teardown` needs `TEARDOWN_API_BASE_URL` pointing at the live Teardown API (`https://teardown-api-67886675912.us-central1.run.app/api/v1`); it only uses Teardown's public endpoints, so no token.
3. Downloaded videos live in the private Supabase Storage bucket `corpus-media` at `<adId>/<sha256>.<ext>` (`AdMedia.storagePath`; the hash is re-verified on every read). One copy is shared by the CLI, local dev and the deployed app.

## Commands

| Command | Stage | Notes |
|---|---|---|
| `npm run miner:winners` | INGEST (winners) | **The corpus.** ~100 winners spread evenly across every Spectre competitor: videos still running 21+ days after launch, highest EU spend first. Short brands are topped up from brands with more; the pick becomes the corpus (`corpusIncluded`, `winnerPick`) and other ads are kept but excluded. ~1 BrandSearch credit per ad. `--limit N`, `--min-days N`, `--dry-run` (still spends credits), `--no-media`. |
| `npm run miner:ingest` | INGEST | Spectre competitors, 25 ads/brand, ended ads included. **1 BrandSearch credit per row.** Chains the media download because links die after 3 days. `--dry-run`, `--per-brand N`, `--status active`, `--no-media`. |
| `npm run miner:media` | MEDIA | Downloads what is not yet on disk. `--limit`, `--ad id`, `--brand name`, `--force`. |
| `npm run miner:transcribe` | TRANSCRIBE | Gemini reads the video: `vo` + `ost` segments. Idempotent by (ad, media hash, prompt, model). |
| `npm run miner:extract` | EXTRACT | Beats from the closed taxonomy. Refuses until Gate 1 has passed; `--skip-gate` overrides loudly. `--with-video` attaches the video too. `--retry-review` re-runs quarantined ads. |
| `npm run miner:score` | — | winnerScore, a longevity ranking. Pure arithmetic. |
| `npm run miner:mine` | MINE | Frequency, positional laws, PrefixSpan spines, quartile lift, layer durations. One snapshot per cohort; unchanged corpus = no write. |
| `npm run miner:teardown` | TEARDOWN | Top-quartile winners (by winnerScore, recomputed first) → Teardown's 14-part workbook → `AdTeardown`. Skips completed, retries failed, waits for results. `--dry-run` (list + est. cost), `--limit N`, `--ad id --force`, `--no-wait`. **~$0.15–0.20 per video** (Gemini 2.5 Pro via Teardown). Not part of `miner:run`. |
| `npm run miner:run` | all | In order, with `--until <stage>`. |
| `npm run miner:eval` | Gate 1 | Production extractor, blind, over the gold set. Logged to `CorpusEvalRun`. |
| `npm run miner:dump-ad -- <id> [--run-missing] [--out file]` | — | **The first deliverable**: one ad end to end as JSON. |
| `npm run miner:seed-taxonomy -- --version copy-taxonomy-v2 [--commit]` | — | Seeds a taxonomy version; never mutates an existing one. |
| `npm run test:corpus` | — | Unit tests for the pure modules. |

**In the app:** `/miner/run` runs every stage from the browser (creative strategists only) — one request per ad, a few in parallel, with live per-ad results. It calls the same code as the CLI and uses the same "what's ready" rule (`corpus/queue.ts`), so the two are interchangeable; closing the tab stops after the ads in flight and Run resumes. `/miner` shows stage counts, the review queue, failures, the pattern report and the corpus table; a strategist can mark a quarantined ad as reviewed. Each ad page has **Download JSON** (the first deliverable).

## First deliverable

```powershell
npm run miner:dump-ad -- <competitorAdId> --run-missing --out corpus-media/first-ad.json
```

Compare `beats[]` (each with `evidenceQuote`, `matchScore`, `startSec`/`endSec`, `matchedSegmentId`) against the hand decomposition of the same ad. If it matches, the rest of the corpus is a loop. If it does not, nothing downstream matters.

## Taxonomy and Gate 1

- Today the extractor runs against `copy-taxonomy-v1` (nine generic codes from migration 015) as a placeholder.
- The hand-built list (H1–H17 plus the Q/P/B/M/PR/O codes) goes into `src/lib/cellumove/corpus/taxonomy-seeds.ts` under `copy-taxonomy-v2`; the seed script appends `H_OTHER … O_OTHER` and the global `OTHER`. Then set `CORPUS_TAXONOMY_VERSION=copy-taxonomy-v2`.
- The 35 hand decompositions use the existing gold contract (`docs/script-scorer.md`) and import with `npm run scorer:import-gold -- gold.json --taxonomy copy-taxonomy-v2 --baseline gold-35-v2 --commit`.
- `npm run miner:eval --baseline gold-35-v2 --taxonomy copy-taxonomy-v2` must report ≥0.80 layer agreement and ≥0.70 code agreement before `miner:extract` runs on the corpus. Every eval run is logged with its prompt version; changing a prompt means bumping `CORPUS_EXTRACT_PROMPT_VERSION` in `constants.ts` and re-running.

## Winners corpus

The client brief: about 100 winning ads, spread across competitors, are enough to learn tone and voice. BrandSearch's "Winning Batch / Winning creative" badge is not in its API, so `miner:winners` rebuilds the signal behind it: brands switch losing creatives off within days, so a video still live three weeks after launch, with spend behind it, is a winner. Each ad's `winnerPick` records the rule version, its rank within its brand and when it was picked. Re-running replaces the pick; set-aside ads keep their media, transcripts and beats. `miner:ingest` (25 per brand, including stopped ads) remains for a larger, unfiltered pull.

The `/spy` feed uses the same rule and the same fetch (`fetchWinnerPool`), with image ads included: ~100 winners spread across competitors per refresh (~1 credit per ad; the feed refreshes itself when its media links expire, about every 3 days). Only the two corpus pulls opt ads into the corpus — a Spy refresh saves its ads to `CompetitorAd` but never changes the corpus (migration 021 made `corpusIncluded` default to false).

## Teardown workbooks (winners only)

`miner:teardown` sends the top-ranked ads to the Teardown service, which runs its "winning ad deconstruction" workbook (avatar psychology, hook, pain, mechanism, proof, offer, triggers, visual/audio, learnings — 14 parts) over the video and returns it as labelled fields. The result is mirrored into `AdTeardown` and shown on `/miner/<adId>`; Teardown keeps its own record and appends its Google Sheet row as usual.

It is a **reading layer for strategists, not a data source for MINE.** The workbook is open vocabulary, assumes the ad is a winner, and its ratings are the model's opinion with no evidence gate — the exact traps the spec rules out for the mined statistics. Structure and patterns come from `AdBeat`; Teardown explains the psychology behind a winner in words a writer can use.

The provider video link is sent when still live (Teardown fetches it itself); after it expires, the verified local copy from `miner:media` is uploaded through Teardown's signed-upload route instead.

## Provenance

Every row carries what produced it: `CorpusTranscriptRun.promptVersion`, `CorpusExtractRun.{taxonomyVersion, extractorPromptVersion, engineVersion, model, withVideo}`, `AdBeat.{extractorPromptVersion, model, matchScore, matchedSegmentId}`, `CorpusPatternReport.inputHash`, `CompetitorAd.winnerScoreVersion`. Model calls are also in the `Usage` table under `corpus_transcribe`, `corpus_extract`, `corpus_eval`.

## Known limits

- Videos over 15 MB cannot be sent inline to Vertex; the SD rendition is tried first, otherwise the ad is marked `oversize`. A GCS bucket + `fileData.fileUri` would lift that.
- Gemini timestamps are roughly ±1 s; the gate tolerates that and the duration stats should not be read finer than a second.
- On-screen text can be misread. Captions are deduped to first appearance, carry a confidence, and the voiceover channel is cross-checked against BrandSearch's transcript where one exists.
- `winnerScore` is a ranking proxy (days active heaviest, then variants, placements, concept reuse). It is labelled as such everywhere and must not be read as ROAS.
- The corpus is multilingual; prompts forbid translation. Compare within a format or brand cohort before drawing cross-language conclusions.
