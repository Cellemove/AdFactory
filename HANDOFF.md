# Handoff — CelluMove Ad Factory

**Updated:** 2026-08-22
**Branch:** `Kamino-updates`
**Stack:** Next.js 15 (App Router) · React 19 · Supabase (Postgres) · Gemini 2.5 Pro on Vertex AI (`@google/genai`) · Tailwind · Zod · tsx
**Default model:** `gemini-2.5-pro` (see `src/lib/llm.ts`); b-roll clip analysis uses `gemini-2.5-flash`

---

## 1. Current state of the app

The old strategist→copywriter→compliance→designer script pipeline has grown into a
**gated G1→G7 generation pipeline** plus a set of intelligence pages:

- **Pipeline (`/pipeline`)** — per sub-avatar runs through: G2 Avatar Deep Dive (grounded,
  progressive multi-pass Reddit/YouTube mining with soft/medium/high thread targets) →
  AIR Avatar Intelligence Report → G3 Root Cause & Mechanism → Brand DNA → G4 Copy Arsenal →
  G5 Advertorial → G6 Ad Scripts → G7 Creative Briefs. Definitions in
  `src/lib/cellumove/pipeline-stages.ts`, runner in `src/app/actions/pipeline-run.ts`.
  Each stage output is claim-scanned + cited-URL-checked (`verifyStageOutput`).
  Runs persist as `Research` rows (`type: "pipeline"`, doc as JSON in `drafts`) — no dedicated table.
- **B-roll library (`/broll`)** — indexes the client's Google Drive b-roll
  (Creative Crafters folder): Drive sync, Gemini watches each clip and writes a dense
  description + tags (`analyzeBroll`), paginated/searchable library page, and a
  **suggestion feedback loop**: G7 briefs name real clips, mentions are counted
  (`timesSuggested` / `BrollSuggestion`), and least-suggested clips are preferred in future
  prompts so footage doesn't get overused. Editors can mark clips actually used (`timesUsed`).
- **Spy (`/spy`)** — grounded sweep of competitor ad creatives, og:image scraped so they render.
- **Verbatims, Reviews, Winners, Big Swings, Usage, Agents** — supporting pages; `/agents`
  is the live roster (role + SOPs + what each reads from the deep dive).
- **Agent layer** — `src/lib/cellumove/agents.ts`: `runAgent()` = role (`strategist` /
  `copywriter` / `researcher` / `designer`) + SOPs loaded from the `Sop` table by roleScope +
  one Gemini call. Write a SOP in /knowledge and the matching agent obeys it next run.

Recent commits (this branch): b-roll indexing + analysis page, suggestion counting,
paginated library, migration 007/008, UI polish. Working tree is clean.

---

## 2. Next feature — Copywriter agent (planned, not started)

Goal: a **standalone interactive Copywriter workbench** at `/copywriter`. Today copy only
comes out of a full pipeline run; this lets a strategist task the copywriter directly
("10 hooks for this angle", "rewrite this winner", "5 punchier primary texts") with
multi-turn follow-ups. Plan (reuse-first, no migration):

1. **Extract shared context builders** — `loadAvatarContext`, `researchBlock`,
   `deepDiveBlock` are private to `pipeline-run.ts` (a `"use server"` file can only export
   async functions). Move them to a plain lib (`src/lib/cellumove/context.ts`) imported by
   both the pipeline runner and the new action. Pure move.
2. **`src/app/actions/copywriter.ts`** —
   - `createCopySession(subAvatarId)`: persists a `Research` row (`type: "copywriter"`,
     turns as JSON in `drafts`) — same zero-migration trick as pipeline/spy.
   - `askCopywriter(sessionId, message)`: context = BRAND_BASE + CLAIMS_GUARDRAIL +
     researchBlock (G1) + `renderCopywriterProfile` + G2 verbatim sample + the latest
     pipeline run's Copy Arsenal / Brand DNA / mechanism for that avatar (query
     `type: "pipeline"`, `focus` = sub name, like `priorRunsNoveltyBlock`) + last N turns.
     One `runAgent({role: "copywriter"})` call, free-form text (not JSON). `scanClaims`
     on each reply; store flags with the turn. Copywriter SOPs apply automatically.
3. **`/copywriter` page + `CopywriterClient.tsx`** — session list, thread view, textarea,
   quick-prompt chips (10 hooks / 5 headlines / primary texts / rewrite). Claim flags as
   warning chips with a one-click "fix flagged" follow-up. Nav entry, strategists only.

Deliberately skipped for MVP: streaming (server actions can't; add a route handler only if
waits hurt), embedding retrieval over the verbatim corpus (the 80-verbatim sample block is
enough to start), save-to-pipeline/winners (copy button first).

Open questions for the client: chat vs. simple form (recommend chat — iteration is the
point), and whether sessions may run brand-only with no avatar attached (recommend yes,
fail-soft).

Scope estimate: 2 new files + 1 extraction + a nav line. ~1 day.

---

## 3. Activation checklist

- [ ] **Supabase project must be live** — it was paused at one point (NXDOMAIN on the API
      host). If DB calls fail, restore the project in the Supabase dashboard first.
- [ ] **Migrations 001–008** applied in the Supabase SQL editor (007 = `BrollClip`,
      008 = b-roll intelligence columns: `aiDescription`, `tags`, `timesSuggested`,
      `timesUsed`, `analyzedAt`, `BrollSuggestion`). Actions fail-soft with a message
      naming the missing migration.
- [ ] **`npm run seed:sop`** — seeds reference formats, market profiles, deep-dive template.
- [ ] **GCP/Vertex creds** — `GOOGLE_CLOUD_PROJECT` + ADC
      (`gcloud auth application-default login`) or `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
- [ ] **Drive b-roll** — share the b-roll folder with the service account's
      `client_email` (shown by `driveServiceAccountEmail()` in the /broll setup UI) and set
      `GOOGLE_DRIVE_BROLL_FOLDER_ID` (comma-separated ids allowed). Drive access reuses the
      same SA via a hand-rolled JWT flow (`src/lib/drive.ts`) — no extra dependency.
- [ ] **Reddit OAuth** (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`) — free "script" app;
      anonymous Reddit JSON is 403-blocked.
- [ ] **Optional:** `SCRAPER_PROXIES` (residential needed for anon Reddit), YouTube key if
      `src/lib/youtube.ts` requires one — check `.env.example` for the canonical list.

---

## 4. Key files

```
src/lib/cellumove/pipeline-stages.ts   G2→G7 stage definitions (instructions, schemas, depths)
src/app/actions/pipeline-run.ts        stage runner, progressive deep-dive accumulator, verification
src/lib/cellumove/agents.ts            runAgent() — role + SOPs + one Gemini call
src/lib/cellumove/avatar-profile.ts    profile Zod schema + per-role renderers
src/app/actions/broll.ts               Drive sync, clip analysis, suggestion counting, paged search
src/lib/drive.ts                       Drive REST via the Vertex service account (readonly)
src/app/actions/spy.ts                 competitor creative sweep (Research type "competitor_spy")
src/app/actions/sops.ts                SOP CRUD + PDF import
src/lib/reddit.ts / src/lib/youtube.ts verbatim + comment fetchers (proxy-aware)
src/lib/cellumove/claim-check.ts       deterministic compliance scan (scanClaims)
src/app/agents/page.tsx                agent roster page
migrations/                            001–008 (all required)
```

---

## 5. Known gaps / risks

- **Copywriter agent not built** — plan in §2; nothing implemented yet.
- **Old handoff items still open where not superseded:** verbatim loop (research →
  `Verbatim` rows) and real image/video generation (Imagen/Veo) remain undone.
- **B-roll analysis caps at 15 MB/clip** — bigger clips are marked analyzed-but-skipped and
  stay description-less; they match by filename only.
- **Suggestion counting is text-scan** (exact clip-name mentions, length-guarded) — survives
  schema drift but can miss renamed/short-named clips.
- **Gemini grounding can't be confined to subreddits** — steering is `site:` prompts + the
  deterministic fetchers.

---

## 6. Running & verifying

```bash
npm run dev          # dev server on :3000
npm run typecheck    # tsc --noEmit
npm run build        # production build
npm run seed:sop     # seed formats, markets, deep-dive template SOP
```
