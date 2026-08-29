# Resource-grounded Script Studio generation

Script Studio creates a complete editable draft with Gemini 2.5 Pro before a new
project opens. Existing projects expose **AI fill all**; locked modules are kept and
every unlocked module is regenerated.

## Resources

The generator assembles a bounded context from:

- the selected AdFactory product and its locally editable Shopify snapshot;
- angle mechanism and banned-mechanism rules;
- selected avatar research and structured deep-dive profile;
- high-ranked avatar and angle verbatims;
- pinned/recent knowledge notes and writing principles;
- angle-matched winning ads and the latest pipeline intelligence;
- the selected reference framework and example scripts;
- the selected Teardown2 analysis; and
- indexed B-roll clips, including content descriptions and prior suggestion counts.

Role-scoped Strategist, Copywriter, and Designer SOPs remain system instructions.
Imported resources are delimited as untrusted evidence and cannot override those
instructions.

## Output contract and safeguards

Prompt version: `script-draft-v1`.

The model must return strict JSON containing three to eight hook alternatives and
one result for every existing module ID. Spoken copy, on-screen text, and visual
direction must be non-empty. Module labels, order, kind, and timing remain controlled
by the selected framework.

AdFactory validates the JSON with Zod, rejects missing or extra module IDs, enforces
per-beat spoken-word budgets, rejects invented B-roll IDs, maps accepted IDs to the
real Drive clips, and scans spoken/on-screen copy for prohibited claims. A rejected
response is returned to Gemini for a targeted rewrite, up to three attempts. Invalid
output is never persisted.

Every accepted generation creates a named ScriptVersion with the model and prompt
version, logs the resource counts in ScriptEvent, and snapshots the resources in
ScriptSource. This makes the strategist's edits and the AI starting point auditable.

## Operational limits

- Vertex AI credentials are required; generation fails clearly instead of creating
  a misleading empty script when Gemini is unavailable.
- Optional resource tables fail soft. A draft can still be created from the resources
  that exist, but output quality depends on the depth and accuracy of those resources.
- AI output is a strategist-ready first draft, not legal approval. Deterministic claim
  checks block known hard terms, but a human must still review substantiation and offer
  accuracy before publishing.
- Regeneration preserves locked modules and replaces unlocked module content.

## Verification

```bash
npm run test:script-generation
npm run test:script-studio
npm run test:teardown
npm run typecheck
npm run lint
npm run build
```
