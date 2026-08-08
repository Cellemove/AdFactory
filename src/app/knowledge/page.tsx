import { supabase, unwrap } from "@/lib/db";
import { KnowledgeClient } from "./KnowledgeClient";
import { SopFoundationClient } from "./SopFoundationClient";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [notesRes, principlesRes, sopsRes, formatsRes, marketsRes] = await Promise.all([
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
  ]);
  const notes = unwrap(notesRes);
  const principles = unwrap(principlesRes);
  // Tolerate a not-yet-migrated DB: render empty instead of crashing the page.
  const sops = sopsRes.error ? [] : sopsRes.data ?? [];
  const formats = formatsRes.error ? [] : formatsRes.data ?? [];
  const markets = marketsRes.error ? [] : marketsRes.data ?? [];
  const migrationPending = Boolean(sopsRes.error || formatsRes.error || marketsRes.error);

  return (
    <div className="space-y-6">
      <section>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="text-sm text-ink-500">SOPs + reference formats + market profiles + free-form notes &amp; copy principles.</p>
        </header>
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
