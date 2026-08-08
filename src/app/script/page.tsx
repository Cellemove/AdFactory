import { supabase } from "@/lib/db";
import { ScriptClient } from "./ScriptClient";
import type { AngleRow, SubAvatarRow, ReferenceFormatRow, MarketProfileRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function ScriptPage() {
  const [anglesRes, subsRes, researchRes, formatsRes, marketsRes] = await Promise.all([
    supabase.from("Angle").select("id,name,slug").order("order", { ascending: true }),
    supabase.from("SubAvatar").select("id,name,angleId,shortDesc").order("name", { ascending: true }),
    supabase.from("AvatarResearch").select("subAvatarId"),
    supabase.from("ReferenceFormat").select("*").order("order", { ascending: true }),
    supabase.from("MarketProfile").select("*").order("order", { ascending: true }),
  ]);

  const angles = (anglesRes.error ? [] : anglesRes.data ?? []) as Pick<AngleRow, "id" | "name" | "slug">[];
  const subs = (subsRes.error ? [] : subsRes.data ?? []) as Pick<SubAvatarRow, "id" | "name" | "angleId" | "shortDesc">[];
  const researched = new Set(
    (researchRes.error ? [] : researchRes.data ?? []).map((r) => (r as { subAvatarId: string }).subAvatarId),
  );
  const formats = (formatsRes.error ? [] : formatsRes.data ?? []) as ReferenceFormatRow[];
  const markets = (marketsRes.error ? [] : marketsRes.data ?? []) as MarketProfileRow[];

  const angleName = new Map(angles.map((a) => [a.id, a.name]));
  const subOptions = subs.map((s) => ({
    id: s.id,
    name: s.name,
    angleName: angleName.get(s.angleId) ?? "—",
    shortDesc: s.shortDesc,
    hasResearch: researched.has(s.id),
  }));

  return (
    <div className="space-y-6">
      <section>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Script Generator</h1>
          <p className="text-sm text-ink-500">
            Solo lane (Module 5). Pick a sub-avatar + a core idea + reference formats — the agent pipeline
            (Strategist → Copywriter → Compliance → Designer) returns scripts, hooks, and B-roll briefs.
          </p>
        </header>
      </section>

      <ScriptClient
        subOptions={subOptions}
        formats={formats.map((f) => ({ slug: f.slug, name: f.name }))}
        markets={markets.map((m) => ({ code: m.code, name: m.name }))}
      />
    </div>
  );
}
