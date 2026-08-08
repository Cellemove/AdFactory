import { supabase } from "@/lib/db";
import { VerbatimsClient } from "./VerbatimsClient";
import { VERBATIM_CATEGORIES, SOURCE_TYPES } from "@/lib/cellumove/verbatim-taxonomy";
import type { AngleRow, SubAvatarRow, MarketProfileRow, VerbatimRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function VerbatimsPage() {
  const [anglesRes, subsRes, marketsRes, vbRes] = await Promise.all([
    supabase.from("Angle").select("id,name,slug").order("order", { ascending: true }),
    supabase.from("SubAvatar").select("id,name,angleId").order("name", { ascending: true }),
    supabase.from("MarketProfile").select("code,name").order("order", { ascending: true }),
    supabase.from("Verbatim").select("*").order("sourceWeight", { ascending: false }).limit(400),
  ]);

  const angles = (anglesRes.error ? [] : anglesRes.data ?? []) as Pick<AngleRow, "id" | "name" | "slug">[];
  const subs = (subsRes.error ? [] : subsRes.data ?? []) as Pick<SubAvatarRow, "id" | "name" | "angleId">[];
  const markets = (marketsRes.error ? [] : marketsRes.data ?? []) as Pick<MarketProfileRow, "code" | "name">[];
  const verbatims = (vbRes.error ? [] : vbRes.data ?? []) as VerbatimRow[];
  const migrationPending = Boolean(vbRes.error);

  const angleName = new Map(angles.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <section>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Verbatims</h1>
          <p className="text-sm text-ink-500">
            Module 1 — the customer-voice corpus. Mine real comments, classified by category and weighted by
            source &amp; engagement. Feeds avatars, deep dives, and the script pipeline.
          </p>
        </header>
      </section>

      {migrationPending && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The <code>Verbatim</code> table isn&apos;t in the database yet. Run{" "}
          <code>migrations/002_verbatims.sql</code> in the Supabase SQL Editor, then reload.
        </div>
      )}

      <VerbatimsClient
        angles={angles}
        subs={subs.map((s) => ({ id: s.id, name: s.name, angleName: angleName.get(s.angleId) ?? "—" }))}
        markets={markets}
        categories={VERBATIM_CATEGORIES}
        sourceTypes={SOURCE_TYPES.map((s) => ({ slug: s.slug, label: s.label }))}
        verbatims={verbatims}
      />
    </div>
  );
}
