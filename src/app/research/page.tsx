import { supabase, unwrap } from "@/lib/db";
import { ResearchClient } from "./ResearchClient";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [anglesRes, recentRes] = await Promise.all([
    supabase.from("Angle").select("*").order("order", { ascending: true }),
    supabase
      .from("Research")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(30),
  ]);
  const angles = unwrap(anglesRes);
  // Research table is brand new — gracefully handle "table doesn't exist yet".
  const recent = recentRes.error ? [] : recentRes.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Research</h1>
        <p className="text-sm text-ink-500">
          Bypass Runs to prospect new angles, sub-avatars, and concepts. Each session is persisted
          so you can come back to past findings.
        </p>
        <p className="text-sm text-ink-500">
          Webscrapes Reddit, Quora, TikTok, Youtube, Meta and gives context to Gemini for output.
        </p>
      </header>

      {recentRes.error && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The Research table doesn&apos;t exist yet — see the SQL migration in this turn&apos;s chat
          response. Until then this page won&apos;t save anything.
        </div>
      )}

      <ResearchClient
        angles={angles.map((a) => ({ slug: a.slug, name: a.name }))}
        recent={recent.map((r) => ({
          id: r.id,
          type: r.type,
          angleSlug: r.angleSlug,
          focus: r.focus,
          drafts: r.drafts,
          status: r.status,
          createdAt: r.createdAt,
        }))}
      />
    </div>
  );
}
