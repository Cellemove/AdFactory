import { supabase, unwrap } from "@/lib/db";
import { KnowledgeClient } from "./KnowledgeClient";
import { SopFoundationClient } from "./SopFoundationClient";
import Link from "next/link";
import { isBrandSearchConfigured } from "@/lib/brandsearch.server";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [notesRes, principlesRes, sopsRes, formatsRes, marketsRes, competitorAdsRes] = await Promise.all([
    supabase
      .from("KnowledgeNote")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updatedAt", { ascending: false }),
    supabase
      .from("CopyPrinciple")
      .select("*")
      .order("category", { ascending: true })
      .order("order", { ascending: true }),
    // These three tables ship with migration 001. If it hasn't been run yet,
    // tolerate the error and render empty rather than crashing the page.
    supabase.from("Sop").select("*").order("pinned", { ascending: false }).order("order", { ascending: true }),
    supabase.from("ReferenceFormat").select("*").order("order", { ascending: true }),
    supabase.from("MarketProfile").select("*").order("order", { ascending: true }),
    supabase.from("CompetitorAd").select("id, winnerEvidence, reviewStatus"),
  ]);
  const notes = unwrap(notesRes);
  const principles = unwrap(principlesRes);
  // Tolerate a not-yet-migrated DB: render empty instead of crashing the page.
  const sops = sopsRes.error ? [] : sopsRes.data ?? [];
  const formats = formatsRes.error ? [] : formatsRes.data ?? [];
  const markets = marketsRes.error ? [] : marketsRes.data ?? [];
  const migrationPending = Boolean(sopsRes.error || formatsRes.error || marketsRes.error);
  const competitorAds = competitorAdsRes.error ? [] : competitorAdsRes.data ?? [];
  const brandSearchMigrationPending = Boolean(competitorAdsRes.error);
  const probableCount = competitorAds.filter((ad) => ad.winnerEvidence === "probable_winner").length;
  const approvedCount = competitorAds.filter((ad) => ad.reviewStatus === "approved").length;

  return (
    <div className="space-y-6">
      <section>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="text-sm text-ink-500">SOPs + reference formats + market profiles + free-form notes &amp; copy principles.</p>
        </header>
      </section>

      <section className="card border-sky-200 bg-sky-50/40">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">BrandSearch competitor evidence</h2>
              <span className={isBrandSearchConfigured() ? "tag" : "tag border-red-300 text-red-700"}>
                {isBrandSearchConfigured() ? "API key configured" : "not configured"}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-600">
              {probableCount} probable winners indexed · {approvedCount} approved for curation. Provider signals remain
              separate from verified ROAS evidence.
            </p>
            {brandSearchMigrationPending && (
              <p className="mt-1 text-xs text-amber-800">
                Run <code>migrations/016_brandsearch_competitor_ads.sql</code> to enable durable indexing. Imports still
                remain available as Spy sweep snapshots.
              </p>
            )}
          </div>
          <Link href="/spy" className="btn btn-primary shrink-0">Import competitor ads →</Link>
        </div>
      </section>

      {migrationPending && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The SOP / Reference Format / Market tables aren&apos;t in the database yet. Run{" "}
          <code>migrations/001_sop_foundation.sql</code> in the Supabase SQL Editor, then{" "}
          <code>npm run seed:sop</code> to load the starter formats &amp; markets.
        </div>
      )}

      <SopFoundationClient
        sops={sops.map((s) => ({
          id: s.id, slug: s.slug, type: s.type, title: s.title, body: s.body,
          payload: s.payload, roleScope: s.roleScope, marketScope: s.marketScope,
          pinned: s.pinned, order: s.order,
        }))}
        formats={formats.map((f) => ({
          id: f.id, slug: f.slug, name: f.name, description: f.description, beats: f.beats,
          bestForAngle: f.bestForAngle, optimalDurationSec: f.optimalDurationSec,
          exampleScripts: f.exampleScripts, order: f.order,
        }))}
        markets={markets.map((m) => ({
          id: m.id, code: m.code, name: m.name, tone: m.tone, vocabulary: m.vocabulary,
          hooksThatWork: m.hooksThatWork, hooksThatFlop: m.hooksThatFlop,
          allowedClaims: m.allowedClaims, forbiddenClaims: m.forbiddenClaims,
          disclaimerClaims: m.disclaimerClaims, trustpilotScore: m.trustpilotScore,
          culturalNotes: m.culturalNotes, order: m.order,
        }))}
      />

      <KnowledgeClient
        notes={notes.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          pinned: n.pinned,
          tags: n.tags,
          updatedAt: n.updatedAt,
        }))}
      />

      <section>
        <h2 className="text-sm font-semibold">Copy principles</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {principles.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{p.title}</h3>
                <span className="tag">{p.category}</span>
              </div>
              <p className="mt-1 text-xs text-ink-600">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
