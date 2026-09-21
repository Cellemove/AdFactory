import assert from "node:assert/strict";
import test from "node:test";
import { importAdResearch, fetchProviderResearch, getResearchSnapshot } from "../../src/lib/brandsearch-research.server";
import { importResearchTranscript } from "../../src/lib/cellumove/corpus/transcribe.server";
import type { CompetitorAdRow } from "../../src/lib/database.types";

// Closed network: exercises real HTTP adapters and import services. SQL semantics
// are tested separately by brandsearch-budget.test.ts, not inferred from this fake.
test("BrandSearch imports reuse cached evidence and defer safely", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.BRANDSEARCH_API_KEY = "test-only";
  process.env.BRANDSEARCH_RESEARCH_ENABLED = "true";
  type Row = Record<string, unknown>;
  let tables: Record<string, Row[]> = {};
  let calls: Array<{ url: URL; method: string }> = [];
  let transcript: unknown = { transcript: { is_empty: false, duration: 10, hook: "Opening", language: "en", segments: [{ start: 0, end: 3, text: "These exact spoken words", confidence: 1 }] } };
  let analysis: unknown = { analysis: { angle: "Example interpretation" } };
  let behavior: "cache" | "missing" | "timeout" | "rate_limit" | "unavailable" = "cache";
  let reserved = false;
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method });
    if (url.hostname === "api.brandsearch.co") {
      if (url.pathname.endsWith("/ai-analysis")) { assert.equal(method, "GET"); return analysis ? json(analysis) : json({ error: { code: "ai_analysis_not_found" } }, 404); }
      if (method === "POST") { if (behavior === "timeout") throw new Error("Connection lost after dispatch"); assert.equal(body.force_regenerate, false); return json(transcript); }
      if (behavior === "rate_limit") return json({ error: { code: "rate_limit", message: "Try later" } }, 429);
      if (behavior === "unavailable") return json({ error: { code: "transcript_unavailable", message: "Cannot be transcribed" } }, 422);
      return behavior === "cache" ? json(transcript) : json({ error: { code: "transcript_not_found" } }, 404);
    }
    assert.equal(url.hostname, "database.test", "Unexpected external call");
    const name = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      if (name === "reserve_brandsearch_budget") { if (reserved) return json(false); reserved = true; return json(true); }
      assert.equal(name, "claim_ad_research");
      const jobs = tables.AdResearchJob ??= [];
      let job = jobs.find((r) => r.competitorAdId === body.ad_id);
      if (job?.status === "running" || (job?.status === "ready" && !body.refresh)) return json(false);
      if (!job) { job = { competitorAdId: body.ad_id }; jobs.push(job); }
      Object.assign(job, { status: "running", claimToken: body.token }); return json(true);
    }
    const rows = tables[name] ??= [];
    let selected = rows.filter((r) => [...url.searchParams].every(([key, filter]) => !filter.startsWith("eq.") || String(r[key]) === filter.slice(3)));
    if (method === "POST") {
      const entries: Row[] = Array.isArray(body) ? body : [body];
      for (const row of entries) {
        const existing = rows.find((r) => r.id === row.id);
        const prefer = new Headers(init?.headers).get("prefer") ?? "";
        if (existing && !prefer.includes("resolution=")) return json({ code: "23505", message: "duplicate" }, 409);
        if (existing && !prefer.includes("ignore-duplicates")) Object.assign(existing, row);
        if (!existing) rows.push(row);
      }
      selected = entries;
    } else if (method === "PATCH") { selected.forEach((r) => Object.assign(r, body)); }
    const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
    return json(single ? selected[0] ?? null : selected);
  });
  const ad = { id: "ad", externalId: "external", provider: "brandsearch", mediaType: "video", brandName: "Example", sourceUrl: null,
    transcriptUrl: null, videoUrl: null, mediaExpiresAt: "2000-01-01", rawPayload: { creative: { title: "Listing headline", description: "Listing body" } } } as unknown as CompetitorAdRow;
  const reset = () => { tables = {}; calls = []; reserved = false; behavior = "cache"; };
  const posts = () => calls.filter((r) => r.url.hostname === "api.brandsearch.co" && r.method === "POST");

  await t.test("missing transcript URL and expired video do not prevent cached import", async () => {
    reset(); const result = await importAdResearch(ad);
    assert.equal(result.status, "ready"); assert.equal(result.snapshot?.copy.headline, "Listing headline");
    assert.equal(result.snapshot?.coverage.onScreenText, "unassessed"); assert.equal(posts().length, 0);
    const repeat = await importAdResearch(ad); assert.equal(repeat.reused, true);
    assert.equal(calls.filter((r) => r.url.hostname === "api.brandsearch.co").length, 2);
    assert.deepEqual(await getResearchSnapshot(result.snapshot!.id), result.snapshot);
    const run = await importResearchTranscript(ad, result.snapshot!);
    assert.equal(run?.run.mediaId, null); assert.equal(run?.run.source, "brandsearch");
    assert.equal(run?.segments.length, 1); assert.equal(run?.segments[0]?.channel, "vo");
    assert.equal((await importResearchTranscript(ad, result.snapshot!))?.reused, true);
  });
  await t.test("no speech stays empty and absent cached analysis is not purchased", async () => {
    reset(); const original = transcript; const oldAnalysis = analysis;
    transcript = { transcript: { is_empty: true, segments: [] } }; analysis = null;
    const result = await importAdResearch(ad);
    assert.equal(result.snapshot?.transcript.status, "empty"); assert.equal(result.snapshot?.analysis.status, "missing");
    assert.equal(result.status, "ready"); assert.equal(posts().length, 0);
    transcript = original; analysis = oldAnalysis;
  });
  await t.test("one generation request; overlapping imports share the claim", async () => {
    reset(); behavior = "missing";
    const results = await Promise.all([importAdResearch(ad), importAdResearch(ad)]);
    assert.equal(posts().length, 1); assert.equal(results.reduce((n, r) => n + r.creditsUsed, 0), 1);
  });
  await t.test("exhausted allowance and rate limits defer without fallback video or AI calls", async () => {
    reset(); reserved = true; behavior = "missing";
    assert.equal((await importAdResearch(ad)).status, "deferred"); assert.equal(posts().length, 0);
    reset(); behavior = "rate_limit";
    const result = await importAdResearch(ad); assert.equal(result.status, "deferred");
    assert.equal(result.snapshot?.transcript.status, "error"); assert.equal(posts().length, 0);
  });
  await t.test("timeout reconciles with GET and never automatically repeats POST", async () => {
    reset(); behavior = "timeout";
    assert.equal((await importAdResearch(ad)).status, "deferred");
    assert.equal((await importAdResearch(ad)).status, "deferred"); assert.equal(posts().length, 1);
    behavior = "cache";
    assert.equal((await importAdResearch(ad)).status, "ready"); assert.equal(posts().length, 1);
  });
  await t.test("malformed cached transcript is quarantined without paying to replace it", async () => {
    reset(); transcript = { transcript: { is_empty: false, segments: [{ start: 5, end: 1, text: "bad" }] } };
    const result = await importAdResearch(ad); assert.equal(result.snapshot?.transcript.status, "error"); assert.equal(posts().length, 0);
    await assert.rejects(fetchProviderResearch("external", "ai-analysis", true), /disabled/);
  });
  await t.test("a permanent provider verdict never buys a transcript and backs off for weeks, not an hour", async () => {
    reset(); behavior = "unavailable";
    const result = await importAdResearch(ad); assert.equal(result.status, "deferred"); assert.equal(posts().length, 0);
    const next = Date.parse(String(tables.AdResearchJob![0]!.nextAttemptAt));
    assert.ok(next - Date.now() > 29 * 86_400_000);
  });
});
