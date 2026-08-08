# Handoff — CelluMove Ad Factory

**Branch:** `phase-2`
**Stack:** Next.js 15 (App Router) · React 19 · Supabase (Postgres) · Gemini 2.5 Pro on Vertex AI (`@google/genai`) · Tailwind · Zod · tsx
**Default model:** `gemini-2.5-pro` (see `src/lib/llm.ts`)

This session deepened the research → script generation chain end-to-end: richer sourcing,
a structured avatar "deep dive" that's captured and fed into every agent, an agent roster
page, angle-targeted subreddits, a PDF→SOP importer, and a proxy-capable scraper.

---

## 1. What shipped this session

### Committed (`3b63e1e` — "Seed content + targeted subreddit")

1. **Deeper research sourcing**
   - Added Gemini's `urlContext` tool alongside `googleSearch` in all three research calls so the
     model reads *full* pages, not snippets. Prompts gained a "READ IN FULL" directive.
   - New `src/lib/reddit.ts` — Reddit verbatim fetcher (app-only OAuth, anon `.json` fallback).
     `gatherRedditVerbatims()` pulls real comment text into every research prompt.
   - Files: `src/app/actions/research.ts`, `src/lib/reddit.ts`, `.env.example`.

2. **Deep-dive template (research quality bar)** — `src/lib/cellumove/deep-dive-template.ts`
   - Distilled the hand-authored 90-page deep dive into a reusable section spec + quality bar.
   - Loaded DB-first as an editable `deep_dive_template` SOP, with a built-in constant fallback.
   - Seeded by `scripts/seed-sop-foundation.ts`.

3. **Structured avatar profile** — `src/lib/cellumove/avatar-profile.ts`
   - `AvatarProfileSchema` (Zod) mirroring 14 deep-dive sections + `parseAvatarProfile()`, which is
     fault-tolerant (accepts object or JSON string, strips unknowns, isolates malformed sections).
   - `migrations/003_avatar_profile.sql` adds the `profile` TEXT column to `AvatarResearch`.
   - Research emits + persists the profile; save degrades gracefully if the column is missing.
   - Draft cards show a "deep profile · N" tag.

4. **Pipeline consumes the profile** — `src/app/actions/pipeline.ts`
   - `loadContext` parses the profile and threads it through `ctx`.
   - Tailored prompt blocks per agent (renderers live in `avatar-profile.ts`):
     - **Strategist** — primary emotion, scored buying emotions, hesitation + counter-strategy,
       ranked desires, ranked angle candidates.
     - **Copywriter** (main + corrective) — voice profile, power words, exact phrases-to-use,
       a **HARD BAN** on the avatar's rejected clichés, sentence/punctuation rules, pain/desire
       ratio, the hook bridge, real verbatims.
     - **Designer** — concept directions, trust signals, identification.
   - **New compliance "resonance gate"** in `checkScript`: flags the avatar's `forbiddenWords` so the
     corrective pass rewrites them into her own phrasing.

5. **Agents page** — `src/app/agents/page.tsx` (added to `src/components/nav.tsx`)
   - Roster of all 5 agents, their pipeline stage, what each reads from the deep dive, and their
     live SOPs (from the `Sop` table). Fail-soft if the table isn't migrated.

6. **Angle-targeted subreddits** — `src/lib/cellumove/subreddits.ts`
   - 26-sub master list in 6 keyword-matched clusters (postpartum, lipedema/circulation,
     legs/venous, joint, body/weight, fashion/shape) + a base set.
   - `subredditsForAngle()` picks the relevant cluster(s) per angle; wired into all three research
     prompts and into `gatherRedditVerbatims` (in-subreddit `restrict_sr` search).
   - Fixed a wrong slug: `r/EDS` → `r/ehlersdanlos`.

### Uncommitted (in the working tree — review, then commit)

7. **SOP PDF import + template**
   - `importSopsFromPdf()` in `src/app/actions/sops.ts` — Gemini reads the PDF **natively** (no PDF
     library), splits it into SOP rows, validates type/roleScope, upserts each.
   - **Import PDF** button + result banner on the Knowledge → SOPs tab (`SopFoundationClient.tsx`).
   - Printable template at `public/sop-template.html` (open → Print → Save as PDF → upload back).
   - Note: relies on `serverActions.bodySizeLimit` ("10mb", already in `next.config.ts`).

8. **Proxy-capable web scraper** — `src/lib/scraper.ts`
   - Rotating proxy pool via undici's `ProxyAgent` (no new dependency), browser-like headers,
     timeouts, retries, fail-soft. No-dependency HTML→readable-text extraction. `scrapeUrl()` for
     general use; `nextProxyDispatcher()` shared with `reddit.ts`.
   - Reddit token + data requests now egress through the proxy pool when configured.

---

## 2. Activation checklist (required to make it all work)

These are **manual steps** — the code is in place but dormant until done:

- [ ] **Run `migrations/003_avatar_profile.sql`** in the Supabase SQL editor (adds the `profile`
      column). Until then, research saves the flat fields and silently drops the structured profile.
- [ ] **Run `npm run seed:sop`** — seeds reference formats, market profiles, and the editable
      `deep_dive_template` SOP. (Requires migration 001 first; 001/002 should already be applied.)
- [ ] **Confirm GCP/Vertex creds** — research, the pipeline, and the SOP importer all call Gemini.
      Set `GOOGLE_CLOUD_PROJECT` + ADC (`gcloud auth application-default login`) or
      `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
- [ ] **Set Reddit OAuth** (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`) — a free "script" app at
      <https://www.reddit.com/prefs/apps>. Anonymous Reddit JSON is 403-blocked; OAuth is the
      reliable free path. (Do **not** use Reddit's Devvit platform — wrong product.)
- [ ] **Optional: proxies** (`SCRAPER_PROXIES`) — only needed for the no-API sources or to give the
      anon Reddit path a residential IP. Residential required for Reddit; datacenter still 403s.
- [ ] **Commit features 7 & 8** once reviewed.

---

## 3. Environment variables

See `.env.example` for the canonical list. Summary:

| Var | Purpose |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Vertex AI project (required for all Gemini calls) |
| `GOOGLE_CLOUD_LOCATION` | defaults to `global` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | service-account JSON (prod); or use ADC locally |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (DB + seed script) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit app-only OAuth (verbatim fetcher) |
| `REDDIT_USER_AGENT` | optional UA override |
| `SCRAPER_PROXIES` / `SCRAPER_PROXY` | optional proxy pool (http/https only) |
| `SCRAPER_USER_AGENT` | optional browser UA for the scraper |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for image uploads (existing) |

---

## 4. Key files

```
src/app/actions/research.ts          three research calls (sub-avatar, angle, concept)
src/app/actions/pipeline.ts          script pipeline: strategist→copywriter→compliance→designer
src/app/actions/sops.ts              SOP CRUD + importSopsFromPdf
src/lib/reddit.ts                    Reddit verbatim fetcher (OAuth/anon, proxy-aware)
src/lib/scraper.ts                   proxy fetch + readable-text extraction
src/lib/cellumove/avatar-profile.ts  profile Zod schema + parser + per-agent renderers
src/lib/cellumove/deep-dive-template.ts  research quality bar
src/lib/cellumove/subreddits.ts      angle→subreddit clusters
src/lib/cellumove/agents.ts          runAgent() — role + SOPs + one Gemini call
src/app/agents/page.tsx              agent roster page
migrations/003_avatar_profile.sql    profile column (NEW — run it)
public/sop-template.html             printable SOP template
```

---

## 5. Known gaps / risks

- **Profiles are unproven live.** Profile generation hasn't been validated against real Gemini
  output (no GCP creds during the session). Inspect a real run before trusting it at scale —
  watch for truncation, since one call currently emits 3–4 full profiles.
- **The profile is invisible/uneditable in the UI.** It's captured and consumed by the pipeline,
  but there's no viewer/editor. The hand-authored 90-page deep dive can't be imported yet.
- **Verbatim loop not closed.** The `Verbatim` table + taxonomy exist, but research doesn't write
  the profile's `languageMining` items into it. `/verbatims` won't fill from deep dives.
- **Reddit anon is 403-blocked** from normal IPs — needs OAuth (free) or residential proxy.
- **4 subreddit slugs unverified** — `cellulite`, `Veins`, `compressionsocks`, `PPD` are parked in
  `UNVERIFIED_SUBREDDIT_CANDIDATES` (kept out of the active list). Verify and promote.
- **Gemini grounding can't be confined to subreddits** — the `googleSearch` tool has no
  include/allowlist (only `excludeDomains`, Vertex-only). Steering is `site:` prompt suggestions +
  the deterministic `gatherRedditVerbatims` fetcher. Opportunity: wire `excludeDomains` to blocklist
  the SEO/content-farm sites the prompts already reject.
- **Image/video generation still prompt-only.** The `nano_banana_pro` prompts exist; rendering real
  creatives (Imagen/Veo) needs paid GCP — the "Ad Factory delivers assets, not prompts" payoff.

---

## 6. Recommended next steps

1. **Validate (Phase 0):** run migration 003 + `npm run seed:sop`, set creds, do one real
   sub-avatar research run, inspect the profile, then run the pipeline and eyeball the copy shift.
2. **Make the deep dive visible + ingestible (Phase 1):** profile viewer + editor on the avatar
   page, and a **PDF importer** that parses an existing deep dive into `AvatarProfile` (highest
   leverage — you already own gold-standard deep dives).
3. **Close the verbatim loop (Phase 2):** on save, fan `languageMining` items into `Verbatim` rows.
4. **Harden generation (Phase 3):** split discovery (flat candidates) from a dedicated "deepen this
   avatar" call; switch to Gemini structured output (`responseSchema`); verify the parked slugs.
5. **Expand (Phase 4):** Meta Ad Library API (free token) for real running ads; image generation.

---

## 7. Running & verifying

```bash
npm run dev          # dev server on :3000
npm run typecheck    # tsc --noEmit (clean as of this handoff)
npm run build        # production build
npm run seed:sop     # seed formats, markets, deep-dive template SOP
```

All routes serve 200 with the current changes (`/`, `/research`, `/avatars`, `/agents`,
`/knowledge`, `/script`, `/new`, `/runs`). Typecheck is clean.
