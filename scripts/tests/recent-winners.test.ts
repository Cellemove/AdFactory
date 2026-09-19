import assert from "node:assert/strict";
import test from "node:test";
import { deconstructAd, runRecentWinners } from "../../src/lib/cellumove/corpus/runner.server";
import { fetchBrandWinners } from "../../src/lib/brandsearch.server";
import { loadAdTeardowns } from "../../src/lib/cellumove/corpus/teardown.server";
import { competitorAdId } from "../../src/lib/cellumove/corpus/ids";
import { GET } from "../../src/app/api/cron/recent-winners/route";

// Exercise the real runner/HTTP adapters with a closed, in-memory network.
// No .env is loaded; any unexpected destination fails the test.
test("recent-winner guards, budget and provider contracts", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.BRANDSEARCH_API_KEY = "test-only";
  process.env.TEARDOWN_API_BASE_URL = "https://teardown.test/api/v1";
  type Row = Record<string, unknown>;
  let ads: Row[] = [];
  let teardowns: Row[] = [];
  let providerAds: Row[] = [];
  let calls: Array<{ url: URL; method: string; body: Row | null }> = [];
  const json = (data: unknown, headers = {}) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json", ...headers } });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Row : null;
    calls.push({ url, method, body });
    if (url.hostname === "database.test") {
      const table = url.pathname.split("/").at(-1);
      let rows = table === "CompetitorAd" ? ads : table === "AdTeardown" ? teardowns : [];
      if (method === "POST") {
        assert.ok(body);
        const key = table === "CompetitorAd" ? "id" : "competitorAdId";
        const existing = rows.find((row) => row[key] === body[key]);
        if (existing) Object.assign(existing, body);
        else rows.push(body);
        return json(body);
      }
      for (const [key, filter] of url.searchParams) {
        if (filter.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === filter.slice(3));
        if (filter.startsWith("gte.")) rows = rows.filter((row) => String(row[key]) >= filter.slice(4));
        if (filter.startsWith("in.(")) rows = rows.filter((row) => filter.slice(4, -1).split(",").map((s) => s.replaceAll('"', "")).includes(String(row[key])));
      }
      if (method === "HEAD") return new Response(null, { headers: { "content-range": `0-0/${rows.length}` } });
      const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
      return json(single ? rows[0] ?? null : rows);
    }
    if (url.hostname === "api.brandsearch.co") {
      if (url.pathname.endsWith("spectre-folders")) return json({ data: [{ id: "folder" }] });
      if (url.pathname.endsWith("/folder")) return json({ id: "folder", items: [{ brand_id: "example.com" }] });
      if (url.pathname.endsWith("meta-ads/query")) return json({ data: providerAds, pagination: { page: 1, page_size: 4, total: providerAds.length } }, { "x-credits-used": String(providerAds.length) });
    }
    if (url.hostname === "teardown.test") return json({ id: "job", status: method === "POST" ? "queued" : "processing" });
    throw new Error(`Unexpected test request: ${url}`);
  });
  const seed = (status?: string, extra: Row = {}) => {
    calls = [];
    ads = [{ id: "ad", brandName: "Example", externalId: "external", platform: "meta", mediaType: "video", videoUrl: "https://cdn.test/video.mp4", rawPayload: {}, mediaExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...extra }];
    teardowns = status ? [{ id: "row", competitorAdId: "ad", teardownId: "job", status, submittedAt: "2000-01-01T00:00:00Z" }] : [];
  };
  const paid = () => calls.filter((call) => call.url.hostname === "teardown.test" && call.method === "POST");

  await t.test("completed and in-flight work never resubmit", async () => {
    for (const status of ["completed", "queued", "processing"]) {
      seed(status);
      const result = await deconstructAd("ad");
      assert.equal(result.outcome, status === "completed" ? "done" : status);
      assert.equal(paid().length, 0);
    }
  });
  await t.test("images and expired links skip; missing ads fail", async () => {
    seed(undefined, { mediaType: "image" });
    assert.equal((await deconstructAd("ad")).detail, "Not a video");
    seed(undefined, { mediaExpiresAt: "2000-01-01T00:00:00Z" });
    assert.match((await deconstructAd("ad")).detail, /expired/);
    assert.equal((await deconstructAd("missing")).outcome, "failed");
    assert.equal(paid().length, 0);
  });
  await t.test("manual failures retry the existing remote record", async () => {
    seed("failed");
    assert.equal((await deconstructAd("ad")).outcome, "queued");
    assert.equal(paid().length, 1);
    assert.ok(paid()[0]!.url.pathname.endsWith("/job/retry"));
  });
  await t.test("empty ID filters never accidentally sync the entire table", async () => {
    seed("queued");
    assert.deepEqual(await loadAdTeardowns({ ids: [] }), []);
    assert.equal(calls.length, 0);
  });
  await t.test("kill switch syncs pending work without buying provider rows", async () => {
    seed("queued");
    const result = await runRecentWinners({ cap: 0 });
    assert.equal(result.synced, 1);
    assert.equal(result.creditsUsed, 0);
    assert.equal(calls.some((call) => call.url.hostname === "api.brandsearch.co"), false);
    assert.equal(paid().length, 0);
  });
  await t.test("UTC daily cap returns before provider requests; zero budget does too", async () => {
    seed("completed");
    teardowns[0]!.submittedAt = new Date().toISOString();
    assert.equal((await runRecentWinners({ cap: 1 })).reason, "Day cap reached");
    assert.equal(calls.some((call) => call.url.hostname === "api.brandsearch.co"), false);
    assert.equal((await runRecentWinners({ cap: 10, budgetMs: 0 })).reason, "Time budget reached");
  });
  await t.test("dry run validates launch dates and excludes failed rows without writes", async () => {
    seed();
    const date = new Date(Date.now() - 10 * 86_400_000).toISOString();
    providerAds = ["new", "failed"].map((id) => ({ id, start_date: date, status: "active", is_video: true, video_sd_url: "https://cdn.test/video.mp4" }));
    providerAds.push({ ...providerAds[0], id: "old", start_date: "2000-01-01" });
    teardowns = [{ competitorAdId: competitorAdId("brandsearch", "meta", "failed"), status: "failed", submittedAt: "2000-01-01" }];
    const result = await runRecentWinners({ cap: 1, dryRun: true });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.adId, competitorAdId("brandsearch", "meta", "new"));
    assert.equal(calls.some((call) => call.method === "POST" && call.url.hostname !== "api.brandsearch.co"), false);
    assert.ok(calls.find((call) => call.url.hostname === "api.brandsearch.co" && call.method === "POST")!.body!.ad_started_from);
  });
  await t.test("automatic submission preserves corpus flags and sequential replay spends zero", async () => {
    calls = [];
    const result = await runRecentWinners({ cap: 1 });
    assert.equal(result.results[0]!.outcome, "queued");
    const row = calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("CompetitorAd"))!.body!;
    assert.equal("corpusIncluded" in row, false);
    assert.equal("winnerPick" in row, false);
    assert.equal(paid().length, 1);
    assert.equal((await runRecentWinners({ cap: 1 })).reason, "Day cap reached");
    assert.equal(paid().length, 1);
  });
  await t.test("legacy winner query never sends the new date lower bound", async () => {
    calls = [];
    await fetchBrandWinners({ domain: "example.com", startedOnOrBefore: "2026-08-01", page: 1, pageSize: 1, videoOnly: false });
    assert.equal("ad_started_from" in calls[0]!.body!, false);
    assert.equal("is_video" in calls[0]!.body!, false);
  });
  await t.test("cron fails closed and accepts only the configured bearer", async () => {
    calls = [];
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://local.test"))).status, 401);
    process.env.CRON_SECRET = "test-secret";
    assert.equal((await GET(new Request("https://local.test", { headers: { authorization: "Bearer wrong" } }))).status, 401);
    assert.equal(calls.length, 0);
    process.env.RECENT_WINNERS_DAILY_CAP = "0";
    assert.equal((await GET(new Request("https://local.test", { headers: { authorization: "Bearer test-secret" } }))).status, 200);
  });
});
