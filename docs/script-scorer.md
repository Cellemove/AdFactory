# Script Scorer

The Script Scorer evaluates an immutable `ScriptVersion`; it never scores the mutable `ScriptProject.document` draft. Results are experimental diagnostics and do not block or rewrite generation.

## Setup

1. Apply `migrations/015_script_scorer.sql` to the project database.
2. Backfill vectors for verified verbatims:

   ```powershell
   npm run scorer:embed-verbatims
   ```

3. Normalize the gold set to the contract below and validate it without writing:

   ```powershell
   npm run scorer:import-gold -- C:\path\to\gold-set.json
   ```

4. After the report has zero rejected ads, import the baseline:

   ```powershell
   npm run scorer:import-gold -- C:\path\to\gold-set.json --commit
   ```

5. Add approved `BrandFact` and `ProductOffer` rows for product/market combinations that should receive fact verification. Product descriptions and angle mechanisms are intentionally not treated as approved evidence.

## Normalized gold-set contract

```json
[
  {
    "externalId": "ad-001",
    "title": "Example winning ad",
    "angleSlug": "example-angle",
    "format": "UGC",
    "marketCode": "PH",
    "durationSec": 30,
    "scriptText": "Exact full script text.",
    "beats": [
      {
        "orderIndex": 0,
        "layer": "H",
        "code": "H_OPENING",
        "startSec": 0,
        "endSec": 3,
        "evidenceQuote": "Exact full script text."
      }
    ]
  }
]
```

The importer rejects duplicate IDs, non-contiguous beat ordering, unknown taxonomy codes, incomplete timing pairs, unexplained `OTHER` beats, and evidence quotes that are not exact substrings of the ad script. Dry-run validation completes before any write.

## Honest unavailable states

- Structural fit requires at least five gold ads matched by angle and format, or five matched by angle as fallback.
- Grounding requires at least ten verified verbatims with 768-dimensional embeddings in the selected audience cohort.
- Fact verification is `not_configured` until approved product/market records exist.
- There is no combined score until the independent modules have been calibrated against historical performance.

## Verification

```powershell
npm run typecheck
npm run test:script-scorer
npm run test:script-studio
npm run test:script-generation
npm run test:script-rag
npm run test:research-architecture
npm run test:verified-verbatims
npm run build
```

