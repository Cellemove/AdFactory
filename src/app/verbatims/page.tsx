import { supabase } from "@/lib/db";
import { VerbatimsClient } from "./VerbatimsClient";
import { VERBATIM_CATEGORIES, SOURCE_TYPES } from "@/lib/cellumove/verbatim-taxonomy";
import type { AngleRow, SubAvatarRow, MarketProfileRow, VerbatimRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function VerbatimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const angle = typeof sp.angle === "string" ? sp.angle : "";
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const page = Math.max(parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1, 1);
  const from = (page - 1) * PAGE_SIZE;

  // Filters + paging run in the database, so the corpus can grow without the page
  // paying for it (the old version silently truncated at 400 rows).
  let vbQuery = supabase
    .from("Verbatim")
    .select("*", { count: "exact" })
    .order("sourceWeight", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (angle) vbQuery = vbQuery.eq("angleSlug", angle);
  if (cat) vbQuery = vbQuery.eq("category", cat);

  // Category-chip counts are scoped by the angle filter only (so the chips stay
  // useful while one of them is active).
  const catCount = (slug?: string) => {
    let q = supabase.from("Verbatim").select("id", { head: true, count: "exact" });
    if (angle) q = q.eq("angleSlug", angle);
    if (slug) q = q.eq("category", slug);
    return q;
  };

  const [anglesRes, subsRes, marketsRes, vbRes, allCountRes, ...catCountRes] = await Promise.all([
    supabase.from("Angle").select("id,name,slug").order("order", { ascending: true }),
    supabase.from("SubAvatar").select("id,name,angleId").order("name", { ascending: true }),
    supabase.from("MarketProfile").select("code,name").order("order", { ascending: true }),
    vbQuery,
    catCount(),
    ...VERBATIM_CATEGORIES.map((c) => catCount(c.slug)),
  ]);

  const angles = (anglesRes.error ? [] : anglesRes.data ?? []) as Pick<AngleRow, "id" | "name" | "slug">[];
  const subs = (subsRes.error ? [] : subsRes.data ?? []) as Pick<SubAvatarRow, "id" | "name" | "angleId">[];
  const markets = (marketsRes.error ? [] : marketsRes.data ?? []) as Pick<MarketProfileRow, "code" | "name">[];
  const verbatims = (vbRes.error ? [] : vbRes.data ?? []) as VerbatimRow[];
  const migrationPending = Boolean(vbRes.error);
  const total = vbRes.count ?? 0;

  const countByCat: Record<string, number> = {};
  VERBATIM_CATEGORIES.forEach((c, i) => {
    countByCat[c.slug] = catCountRes[i]?.count ?? 0;
  });

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
        filterAngle={angle}
        filterCat={cat}
        page={page}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        total={total}
        angleTotal={allCountRes.count ?? 0}
        countByCat={countByCat}
      />
    </div>
  );
}
