import type { Metadata } from "next";
import { requireStrategist } from "@/lib/authorization";
import type { AngleRow, MarketProfileRow, ProductRow, ScriptProjectRow, ScriptScoreRunRow, ScriptVersionRow, SubAvatarRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { ScorerClient } from "./ScorerClient";

export const metadata: Metadata = { title: "Script Scorer · AdFactory" };
export const dynamic = "force-dynamic";

export default async function ScorerPage({ searchParams }: { searchParams: Promise<{ project?: string; version?: string }> }) {
  await requireStrategist();
  const query = await searchParams;
  const [projectsResult, versionsResult, productsResult, anglesResult, avatarsResult, marketsResult, runsResult, goldCountResult, verbatimCountResult, factCountResult, offerCountResult] = await Promise.all([
    supabase.from("ScriptProject").select("*").order("updatedAt", { ascending: false }),
    supabase.from("ScriptVersion").select("*").order("version", { ascending: false }),
    supabase.from("Product").select("*").order("name"),
    supabase.from("Angle").select("*").order("name"),
    supabase.from("SubAvatar").select("*").order("name"),
    supabase.from("MarketProfile").select("*").order("code"),
    supabase.from("ScriptScoreRun").select("*").order("createdAt", { ascending: false }).limit(20),
    supabase.from("GoldAd").select("id", { count: "exact", head: true }),
    supabase.from("Verbatim").select("id", { count: "exact", head: true }).like("researchId", "verified:%").not("embedding", "is", null),
    supabase.from("BrandFact").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("ProductOffer").select("id", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  const setupError = runsResult.error ?? goldCountResult.error ?? factCountResult.error ?? offerCountResult.error;
  if (setupError) {
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-semibold tracking-tight">Script Scorer</h1><p className="mt-1 text-sm text-ink-500">Evidence-linked diagnostics for immutable Script Studio versions.</p></header>
        <div className="card border-amber-300 bg-amber-50"><h2 className="font-semibold text-amber-900">Database setup required</h2><p className="mt-2 text-sm text-amber-800">Apply <code>migrations/015_script_scorer.sql</code>, then reload this page.</p><p className="mt-2 text-xs text-amber-700">{setupError.message}</p></div>
      </div>
    );
  }
  if (projectsResult.error || versionsResult.error || productsResult.error || anglesResult.error || avatarsResult.error || marketsResult.error || verbatimCountResult.error) {
    throw new Error(projectsResult.error?.message ?? versionsResult.error?.message ?? productsResult.error?.message ?? anglesResult.error?.message ?? avatarsResult.error?.message ?? marketsResult.error?.message ?? verbatimCountResult.error?.message);
  }
  const projects = (projectsResult.data ?? []) as ScriptProjectRow[];
  const versions = (versionsResult.data ?? []) as ScriptVersionRow[];
  const products = (productsResult.data ?? []) as ProductRow[];
  const angles = (anglesResult.data ?? []) as AngleRow[];
  const avatars = (avatarsResult.data ?? []) as SubAvatarRow[];
  const productById = new Map(products.map((item) => [item.id, item]));
  const angleById = new Map(angles.map((item) => [item.id, item]));
  const avatarById = new Map(avatars.map((item) => [item.id, item]));
  const markets = (marketsResult.data ?? []) as MarketProfileRow[];
  const marketOptions = markets.length ? markets.map((market) => ({ code: market.code.toUpperCase(), name: market.name })) : [{ code: "PH", name: "Philippines" }, { code: "US", name: "United States" }];
  const readiness = [
    { label: "Gold baseline ads", value: goldCountResult.count ?? 0, ready: (goldCountResult.count ?? 0) >= 5, note: "Needs ≥5 per matching cohort" },
    { label: "Verified embedded verbatims", value: verbatimCountResult.count ?? 0, ready: (verbatimCountResult.count ?? 0) >= 10, note: "Needs ≥10 per audience cohort" },
    { label: "Approved facts and offers", value: (factCountResult.count ?? 0) + (offerCountResult.count ?? 0), ready: ((factCountResult.count ?? 0) + (offerCountResult.count ?? 0)) > 0, note: "Scoped again by product and market" },
  ];

  return (
    <div className="space-y-6">
      <header><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Script Scorer</h1><span className="tag tag-warn">Experimental</span></div><p className="mt-1 max-w-3xl text-sm text-ink-500">Score an immutable version across four independent modules. There is deliberately no overall score.</p></header>
      <section className="grid gap-3 md:grid-cols-3">
        {readiness.map((item) => <div key={item.label} className="card"><div className="flex items-start justify-between gap-3"><div className="text-sm font-medium">{item.label}</div><span className={item.ready ? "tag tag-ok" : "tag tag-warn"}>{item.ready ? "Available" : "Limited"}</span></div><div className="mt-3 text-2xl font-semibold">{item.value}</div><p className="mt-1 text-xs text-ink-500">{item.note}</p></div>)}
      </section>
      {projects.length ? (
        <ScorerClient
          projects={projects.map((project) => ({ id: project.id, title: project.title, displayName: project.displayName, format: project.format, productName: productById.get(project.productId)?.name ?? "Unknown product", angleName: angleById.get(project.angleId)?.name ?? "Unknown angle", avatarName: project.subAvatarId ? avatarById.get(project.subAvatarId)?.name ?? "Unknown sub-avatar" : null }))}
          versions={versions.map((version) => ({ id: version.id, projectId: version.projectId, version: version.version, changeSummary: version.changeSummary, createdAt: version.createdAt }))}
          markets={marketOptions}
          recentRuns={(runsResult.data ?? []) as ScriptScoreRunRow[]}
          initialProjectId={query.project ?? null}
          initialVersion={query.version && /^\d+$/.test(query.version) ? Number(query.version) : null}
        />
      ) : <div className="card py-10 text-center"><h2 className="font-semibold">No Script Studio projects yet</h2><p className="mt-1 text-sm text-ink-500">Create and snapshot a script before running the scorer.</p></div>}
    </div>
  );
}

