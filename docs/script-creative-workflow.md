# Script Studio creative workflow

## Deployment

1. Apply `migrations/022_script_creative_workflow.sql` to the target Supabase project.
2. Confirm `script-playbook-v1` is the published `ScriptPlaybookVersion`.
3. Deploy the Next.js application.
4. Open `/scripts/new` and verify the readiness panel can read the published playbook.
5. Generate a test script, confirm the automatic Workflow audit appears in the reserved strategy rail, then create an immutable version and run the separate Evidence scorer.

The migration is additive. Existing schema-v1 script documents continue to load through the compatibility reader and are not rewritten in storage.

## Product boundaries

- Workflow audit measures playbook adherence for the mutable draft.
- Evidence scorer measures structural evidence, verbatim grounding, specificity, and factual support for immutable versions.
- Neither score blocks saving, versioning, or editor handoff.
- Product descriptions, angle mechanisms, references, and workflow-source claims are context only. Only approved `BrandFact` and `ProductOffer` records support factual claims.
- `structure_beats` may borrow beat architecture and timing. `full_style` may additionally borrow pacing and general sentence patterns, but never distinctive lines, unsupported claims, or source offers.

## New interfaces

- `GET /api/scripts/readiness`
- `POST /api/scripts/:id/workflow-audits`
- `GET /api/scripts/:id/workflow-audits/latest`
- `POST /api/scripts/:id/workflow-fixes`

All workflow mutations require strategist authorization. Audit and fix requests use the current project revision and document hash for optimistic concurrency.

## Verification

Run:

```powershell
npm run typecheck
npm run test:script-studio
npm run test:script-generation
npm run test:script-workflow
npm run test:script-rag
npm run test:script-scorer
npm run build
```
