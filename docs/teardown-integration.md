# Teardown2 integration

AdFactory imports completed Teardown2 analyses through Teardown's private, versioned API.
The applications do not share Supabase credentials or database tables.

## Configuration

Set these server-only values in AdFactory:

```dotenv
TEARDOWN_API_BASE_URL=http://127.0.0.1:8011/api/v1
TEARDOWN_INTERNAL_TOKEN=<same value as Teardown ADFACTORY_SHARED_SECRET>
```

For the deployed AdFactory app, use the public Cloud Run endpoint instead of localhost:

```dotenv
TEARDOWN_API_BASE_URL=https://teardown-api-67886675912.us-central1.run.app/api/v1
TEARDOWN_INTERNAL_TOKEN=<same value as Teardown ADFACTORY_SHARED_SECRET>
```

Set both values for Production, Preview, and Development in Vercel, then redeploy. A
`127.0.0.1` or `localhost` URL points back to the Vercel runtime and cannot reach a
Teardown server running on a developer computer.

Restart AdFactory after changing its environment. The Script Studio source selector is
enabled only when both values exist and the Teardown API returns completed records.

## Data flow

1. Script Studio lists completed records from `/integrations/adfactory/deconstructions`.
2. Creating a project fetches the selected record's full version-1 snapshot server-side.
3. The complete record is stored in `ScriptProject.teardownSnapshot` and `ScriptSource`.
4. `createTeardownBrief` maps workbook fields into avatar, hook, problem, solution, proof,
   offer, CTA, visual, and learning categories.
5. Script Studio keeps the brief in the editable document, exposes hook references, and
   adds the most relevant insight to each beat's visual direction.

Product, avatar, angle, offer, and compliance data selected in AdFactory remain authoritative.
Teardown insights are creative references and must not silently replace current product facts.
