# AI Image Ads Bank — proposed requirements and implementation plan

Status: partly implemented. Built so far: the standalone bank at `/image-ads`, batch creation, the BrandSearch reference gate with archived copies and a decode + resolution quality floor, concept planning, and single-provider image rendering driven from the browser. Not built: durable server-side batch execution, designer review states and handoff export, and the dedicated `ImageAdBatch`/`ImageAdCandidate` tables (a batch is still one `Research` row of type `image_ad_batch`).

Verified against the live project: image rendering uses `gemini-3-pro-image` (Nano Banana Pro) on Vertex at 2K, which returns 1856 x 2304 for 4:5 in 40-60s, renders display text cleanly, and honours the requested aspect ratio for 4:5, 1:1 and 9:16. `gemini-2.5-pro` returns all 25 concepts in one JSON response in ~72s without truncation. Cost is roughly $0.134 per image, so a 25-ad batch is about $3.35 and 20 minutes of browser-driven rendering, and stores ~135MB of PNGs. `IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_COST_USD` and `IMAGE_SECONDS` override the defaults; `gemini-2.5-flash-image` remains a cheaper, faster, lower-fidelity fallback at ~896 x 1152.

## Goal

Run the same research and creative development process as Pipeline, then produce 20–30 actual static image ads for designers to review and choose from. Save every batch in a reusable, searchable bank.

Proposed default: 25 ads per batch. An ad is a rendered image with its headline, supporting copy where needed, CTA, and brand treatment, plus separately stored copy and design instructions. Prompts alone do not satisfy the output requirement. These are candidates for designer review; selection does not mean the ad has been published or proven to perform.

## What already exists

| Existing capability | Code | Implication |
| --- | --- | --- |
| Research and creative stage definitions | `src/lib/cellumove/pipeline-stages.ts` | Reuse Deep Dive, Avatar Intelligence Report, Root Cause & Mechanism, Brand DNA, Copy Arsenal, Advertorial, Ad Scripts & Copy, and Creative Briefs. Avatar Excavation supplies the starting research. |
| Saved stage outputs and dependencies | `src/app/actions/pipeline-run.ts` | Pipeline runs are stored as `Research` rows with type `pipeline`; downstream work can consume saved context. |
| Manual stage execution and run-all flow | `src/app/pipeline/[id]/PipelineStepper.tsx` | Extend the familiar stepper. Current automatic execution is driven by the browser, so it is not a durable background worker. |
| Batch prompt generation | `src/app/actions/runs.ts`, `src/lib/cellumove/prompt-engine.ts` | The existing run workflow defaults to 25 prompts and accepts up to 40. It produces structured prompts, not rendered images. It does not currently consume the full Pipeline output. |
| Generation records and review verdicts | `src/lib/database.types.ts`, `src/app/runs/[id]/RunDetail.tsx` | Reuse concepts from Brief → Run → Generation and approve/reject/regenerate. The current Regenerate button records a verdict rather than executing image regeneration. |
| Idea Bank | `src/app/actions/bank.ts`, `src/app/bank/BankClient.tsx` | This holds saved external ads from Spy. Generated ads need their own records and workflow. |
| Product images, brand assets, image storage and usage tracking | `src/lib/database.types.ts`, `src/lib/storage.ts`, `src/lib/usage.ts` | Reuse product/reference inputs and storage conventions; add generated-image storage and image-specific usage accounting. |
| Editor access restrictions | `src/lib/auth-gate.ts`, `src/lib/authorization.ts` | Editors currently only access `/reviews`. Expose the designer gallery there and enforce permissions on every action. |

The existing Pipeline and prompt engine contain CelluMove-specific context. Start with CelluMove for the first release; supporting arbitrary brands requires a separate effort to parameterize those assumptions.

## Proposed user journey

1. A strategist opens **AI Ads Image Bank** from the main navigation and starts a batch: avatar (which carries its marketing angle), product, batch size, and output format, plus an optional campaign label. These decisions come before competitor references so the strategy is not anchored around whichever ads look strongest in a general-purpose winner pool. Proposed first-release defaults: 25 ads, 4:5 portrait, 1080 × 1350 final export.
2. The new batch opens on **Choose winning reference ads**: select 3–5 relevant image ads spanning at least two competitors tracked in BrandSearch Spectre. The picker filters by competitor and shows the available winner signals, while making clear that longevity and spend are performance proxies rather than verified ROAS.
3. The strategist assigns at least one inspiration role to every selected reference: **Hook/message**, **Layout/hierarchy**, **Visual format**, **Product presentation**, or **Proof mechanism**. The system analyzes only the assigned characteristics and must not copy competitor branding, wording, or distinctive creative elements.
4. The batch saves the selected BrandSearch ad records, assigned roles, analysis, and durable copies of their reference images. The references guide creative execution within the already-selected avatar and angle.
5. Concept planning and generation stay blocked until that reference set is saved.
6. The batch snapshots the research it needs for the selected avatar, reusing completed Pipeline stages for that avatar where they exist. The bank never starts, blocks on, or modifies a Pipeline run; a batch with no Pipeline research falls back to the avatar research itself.
7. **Image Ad Concepts** adapts the selected reference patterns, research, Copy Arsenal, and Creative Briefs into the requested number of static-ad specifications. Target 60–70% reference-informed concepts and 30–40% original research-led experiments; both groups must remain within the selected avatar, angle, and approved claims.
8. **Generate Images** renders the ads and saves each result as it finishes. Progress distinguishes ready, processing, failed, and needs-review items.
9. The completed batch opens in the bank gallery. Designers compare images, select favorites, reject unsuitable options, or request changes.
10. Designers download their selected images and a handoff containing the copy, raw visual where available, and design notes. All options and decisions remain saved.

The bank is its own top-level section, reachable from the main navigation for browsing previous batches. Pipeline is untouched: it keeps its existing G1–G7 flow with no reference gate and no new required step.

Reference selection lives inside the batch page, `/image-ads/[id]`, as step 1. Batches are created from `/image-ads`.

## How to get 25 useful options

Generate a planned mix before spending on images. For example, use five research-backed message directions with five visual executions each. Directions can address different pains, desires, objections, or usage moments within the selected angle; visual executions can use product focus, lifestyle, typography, an explanatory layout, or a verified proof-led layout where evidence exists.

- Plan approximately 60–70% of the batch as reference-informed executions and 30–40% as original, research-led experiments. Round to whole candidates while preserving the exact requested batch total.
- Record whether each concept is reference-informed or original. For reference-informed concepts, record the source reference IDs, assigned inspiration roles, and extracted patterns used.
- Vary the message, hook, scene, or layout meaningfully; avoid filling the batch with near-identical images.
- Keep every execution within the selected angle and approved product facts.
- Store the exact headline, CTA, primary ad text, visual instructions, and source rationale separately.
- Adapt the matrix to hit exactly 20, 25, or 30 candidate slots.
- Resizes, failed attempts, and previous versions do not count toward the target.
- Use deduplication before rendering and a visual similarity check afterward to flag repetition.

## Minimum requirements

### Inputs and research linkage

- Required before the reference gate: Pipeline ID, product, avatar, and marketing angle.
- Required creative-development gate: 3–5 relevant image-ad references selected from at least two competitors in the current BrandSearch Spectre winner pool. Do not allow concept development or image generation to start until the selection and inspiration roles are saved.
- Required batch inputs: selected BrandSearch reference IDs and roles, target count, product asset, output format, and brand assets needed for the chosen template.
- Optional: campaign label, specific offer, and creative direction.
- Filter and rank the reference pool for relevance to the selected product, avatar, and angle. Let strategists browse all tracked competitors, filter by competitor, inspect a reference at full size, and replace references before continuing. Clearly label the signals that qualified each ad as a likely winner.
- Require at least one inspiration role per selected reference: hook/message, layout/hierarchy, visual format, product presentation, or proof mechanism.
- Persist provider ID, competitor, source URL, available metrics/winner evidence, selection timestamp, assigned roles, extracted-pattern analysis, and a durable copy of each selected image. BrandSearch media URLs expire and must not be the only stored reference.
- Validate required assets before starting paid generation.
- Snapshot the selected competitor references together with the source research, copy, product details, and asset references used by each batch. Later Pipeline edits or BrandSearch refreshes must not silently change existing ads.
- Reuse completed stages only when they match the batch's source context. If an upstream stage changes, explicitly create a new batch/revision instead of mixing old and new outputs.

### Image creation

- Add an actual image-provider adapter. Existing tool-routing labels in the prompt engine are not working image-provider integrations.
- Validate one provider against representative product references before committing to a full batch: product fidelity, usable visuals, supported output sizes, latency, and cost.
- Prefer generating the base visual and composing exact copy, logo, and CTA with controlled templates. Store the base visual and composition specification so designers can revise them.
- Preserve source assets and versions. A regenerated candidate creates a new version; it does not overwrite a designer's selected image.
- Reuse existing copy/claim checks, and add checks for image decode/dimensions, text overflow, missing assets, and visible product errors. Automated review flags concerns; designers make the creative selection.
- Keep failed or clearly defective outputs outside the ready-for-selection count.

### Reliable batch execution

- Persist the batch and all candidate slots before rendering starts.
- Run generation through a durable server-side worker/job mechanism with bounded concurrency. Closing the browser must not cancel or strand the batch.
- Track status, attempts, provider request IDs, errors, and usage per candidate/version.
- Claim jobs atomically; make retries and repeated clicks idempotent. Recover interrupted work without duplicating completed outputs or blindly resubmitting uncertain provider requests.
- Retry transient failures within a configured attempt and spending limit. Keep successful images available when other items fail.
- Mark a batch complete only when its requested number of current candidates is ready. Otherwise show partial completion and the remaining count, with retry controls.
- Show an estimated generation cost before starting and actual/estimated spend afterward. Configure a batch budget; do not assume the current text-token pricing applies to images.

### Designer gallery and handoff

- Image-first grid with full-size previews and a comparison view.
- Filter by batch, avatar, angle, product, format, review status, and date; search headlines and campaign labels.
- Review states: Unreviewed, Selected, Rejected, Changes requested. Keep these separate from rendering states and QA flags.
- Save reviewer, timestamp, and notes. Designers can revise their choices.
- Designers can select/reject/request changes and download. Strategists can start batches and execute paid regenerations in the first release.
- Selected-only download includes final PNGs and a manifest of copy, notes, and source IDs. Include base visuals when available. Editable Figma/PSD files are outside the first release.
- A selection is a designer preference, not a measured performance winner; do not automatically promote it into Winning Ads.

## Implementation approach

1. **Define the image workflow and persistence.** Add dedicated `ImageAdBatch`, `ImageAdCandidate`, and `ImageAdVersion` records, plus a durable job record/mechanism. Batch stores the selected BrandSearch reference IDs, inspiration roles, extracted-pattern analysis, immutable reference snapshot, source snapshot, target count, format, status, creator, and budget. Candidate stores slot index, concept/copy, reference-informed-or-original classification, source-reference attribution, review state, and selected version. Version stores prompts, assets, render/QA status, provider metadata, attempts, and cost. Use uniqueness constraints for batch/slot and job identity. Add SQL migrations and database types. Dedicated records avoid concurrent writes to one large `Research.drafts` document and avoid changing legacy prompt-run semantics.
2. **Add the mandatory BrandSearch reference gate inside the batch.** Once avatar, angle, and product are known, show a cross-competitor image-ad picker backed by the existing Spectre competitor list and imported `CompetitorAd` records. Show only usable image creatives that meet the configured winner-evidence rule, rank them for contextual relevance, require 3–5 selections across at least two competitors, and require an inspiration role for each. Support refresh with an explicit BrandSearch credit warning, download selected media into durable storage, and block concept development until the gate is complete. The gate belongs to the batch, not to Pipeline.
3. **Feed saved research into static concepts.** Read completed Pipeline stages for the batch avatar as input, and link each batch back to the runs it drew from. Introduce an image-specific concept planner that consumes the role-specific reference analysis and saved Pipeline stages, adapts the prompt engine's structured visual recipe, and produces the 60–70% reference-informed / 30–40% original mix. Leave existing G1–G7 behavior unchanged. Reuse research as it stands rather than rerunning it.
4. **Prove rendering, then build batch execution.** Implement one provider adapter, reference-asset loading, controlled text/logo composition, generated-image storage, and image usage records. After a small render trial, connect the durable worker, bounded retries, budget limits, and progress reporting. Deployment must include a worker invocation/recovery mechanism, not only database job rows.
5. **Build the bank and designer review.** Add a strategist gallery such as `/image-ads` and a shared designer gallery under `/reviews/image-ads`, using shared UI/data logic. Add server-side role checks for generation, review, asset access, and downloads. Add filters, preview/compare, selection, comments, and selected export. Link to the existing Idea Bank for optional inspiration.
6. **Validate an end-to-end batch.** Run a 25-ad batch from a real Pipeline using 3–5 image references from at least two competitors, verify the planned reference-informed/original split and source attribution, inspect the outputs with a designer, test failure recovery and access boundaries, and adjust diversity/templates before wider rollout.

Suggested new modules: image-ad context/concept helpers, image-provider adapter, image composition, image batch runner, image-ad actions, gallery/review components. Extend `storage.ts` with a generated-image namespace and `usage.ts` integration with provider-specific cost accounting. Existing corpus run-claim code can inform idempotency patterns, but it is not a ready-made image worker.

## Acceptance criteria

- The bank is a standalone section in the main navigation; Pipeline gains no new required step.
- Product, avatar, and marketing angle are selected before competitor references.
- Before concept development, the batch requires a strategist to select 3–5 relevant winning image ads from at least two competitors in the BrandSearch Spectre pool and assign at least one inspiration role to each.
- The reference picker covers all tracked competitors, supports relevance ranking, competitor filtering, and full-size inspection, and shows why each ad qualifies as a likely winner without presenting proxy signals as verified ROAS.
- Every selected reference remains accessible from a durable stored copy and is traceable to its BrandSearch provider ID, competitor, evidence, selection timestamp, assigned roles, and extracted patterns even after the provider URL expires or the feed refreshes.
- Each batch targets 60–70% reference-informed concepts and 30–40% original research-led experiments, rounded to whole candidates while preserving the requested total. Each reference-informed concept identifies which reference patterns it used.
- Generated concepts do not reproduce competitor branding, wording, or distinctive creative elements.
- A strategist can start a batch from the bank and request 20, 25, or 30 ads.
- The saved batch uses the correct selected competitor references, avatar, angle, product asset, and source-stage snapshot.
- A successful 25-ad batch contains 25 accessible rendered candidates with final ad composition; prompts or repeated size exports do not satisfy this count.
- Designers can browse, compare, select, reject, request changes, and return later without losing decisions.
- Selected assets export with their copy and notes, linked to the exact reviewed version.
- A provider failure preserves successful images; retry targets only missing/failed work within budget.
- Closing/reopening the browser or restarting the worker does not lose progress or duplicate persisted outputs.
- Changing upstream research does not alter an existing batch, and regeneration preserves prior versions.
- Editors can reach their gallery but cannot start paid batches or mutate strategist-only configuration.
- Legacy Pipeline, Runs, Idea Bank, and Reviews behavior still works.

Verification during implementation: unit/integration checks for exact candidate counts, context linkage, job claiming/recovery, versioned selection, budget limits, and authorization; an end-to-end flow including partial failure and retry; visual review at full size and thumbnail size. Run the repository typecheck and relevant existing tests after code changes.

## Proposed defaults to validate with the team

- Product, avatar, and angle are chosen before references so competitive examples guide execution rather than determine strategy.
- Select 3–5 BrandSearch winning image-ad references across at least two Spectre-tracked competitors, with an inspiration role assigned to each, before creative development.
- Target 60–70% reference-informed concepts and 30–40% original research-led experiments per batch.
- 25 static ad candidates per batch, within one avatar/angle and one product.
- Full existing Pipeline process, followed by static concepts, image rendering, and designer review.
- CelluMove first; 4:5 format first. Other sizes and brands are later extensions.
- Designers choose candidates for refinement/use. Automatic publishing, ad-platform integration, performance prediction, and a full design editor are outside the first release.
- Image provider, deployment worker, per-batch spending cap, and acceptable visual quality remain implementation decisions. Verify provider capabilities and current pricing when selecting it; this plan makes no provider-price or timing promises.
