import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("migration, durable claims, UTC reservations and source constraints in PostgreSQL", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table "CompetitorAd" (id text primary key);
    create table "CorpusTranscriptRun" (id text primary key, "mediaId" text not null, "mediaSha256" text not null, "promptVersion" text);
    create table "CorpusExtractRun" (id text primary key);
    create table "ScriptProject" (id text primary key, "teardownRecordId" text);
    insert into "CompetitorAd" select 'ad' || n from generate_series(1,30) n;
    insert into "CorpusTranscriptRun" values ('old','media','sha','corpus-transcribe-v1');
  `);
  const migration = readFileSync("migrations/026_brandsearch_research.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration); // rollout is repeatable
  const reserve = async (id: string, scope = "transcript", cap = 10) =>
    (await db.query<{ ok: boolean }>("select reserve_brandsearch_budget($1,$2,$3) as ok", [id, scope, cap])).rows[0]!.ok;
  await t.test("shared allowance clamps to ten and duplicate requests do not reserve twice", async () => {
    const outcomes = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve(`ad${i + 1}`, "transcript", 100)));
    assert.equal(outcomes.filter(Boolean).length, 10);
    assert.equal(await reserve("ad1"), false);
    assert.equal(await reserve("ad30", "daily_research", 0), false);
    assert.equal(await reserve("ad1", "daily_research"), true);
    assert.equal(await reserve("ad1", "daily_research"), false);
  });
  await t.test("a new UTC day does not retry an uncertain POST", async () => {
    await db.exec(`update "BrandSearchReservation" set day=day-1; update "BrandSearchTranscriptRequest" set "requestedAt"="requestedAt"-interval '1 day';`);
    assert.equal(await reserve("ad1"), false);
    await db.exec(`update "BrandSearchTranscriptRequest" set status='failed' where "competitorAdId"='ad2'`);
    assert.equal(await reserve("ad2"), true);
    assert.equal(await reserve("ad20"), true);
  });
  await t.test("only one caller owns a per-ad lease, including explicit refresh", async () => {
    const claim = async (token: string) => (await db.query<{ ok: boolean }>("select claim_ad_research('ad1',$1,true) as ok", [token])).rows[0]!.ok;
    assert.equal((await Promise.all([claim("cron"), claim("manual")])).filter(Boolean).length, 1);
    await db.exec(`update "AdResearchJob" set "leaseUntil"=now()-interval '1 second' where "competitorAdId"='ad1'`);
    assert.equal(await claim("recovery"), true);
  });
  await t.test("media-free provider imports are valid; fake video runs and mixed script sources fail", async () => {
    await db.exec(`insert into "AdResearchSnapshot" (id,"competitorAdId","schemaVersion","sourceHash",snapshot) values ('snapshot','ad1','v1','hash','{}');`);
    await db.exec(`insert into "CorpusTranscriptRun" (id,source,"sourceHash","researchSnapshotId") values ('speech','brandsearch','hash','snapshot')`);
    await assert.rejects(db.exec(`insert into "CorpusTranscriptRun" (id) values ('fake-video')`), /corpus_transcript_source_media/);
    await assert.rejects(db.exec(`insert into "ScriptProject" (id,"teardownRecordId","researchSnapshotId") values ('script','teardown','snapshot')`), /script_single_competitor_source/);
    const old = (await db.query<{ coverage: { visuals: string } }>(`select coverage from "CorpusTranscriptRun" where id='old'`)).rows[0]!;
    assert.equal(old.coverage.visuals, "unknown");
  });
  await t.test("anonymous callers cannot claim paid work", async () => {
    const access = await db.query<{ allowed: boolean }>(`select has_function_privilege('anon','reserve_brandsearch_budget(text,text,integer)','execute') as allowed`);
    assert.equal(access.rows[0]!.allowed, false);
  });
});
