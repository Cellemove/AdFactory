import type { Metadata } from "next";
import Link from "next/link";
import { requireStrategist } from "@/lib/authorization";
import { supabase } from "@/lib/db";
import type { AngleRow, MarketProfileRow } from "@/lib/database.types";
import { EvidenceLibraryClient } from "./EvidenceLibraryClient";

export const metadata: Metadata = { title: "Scorer Evidence · AdFactory" };
export const dynamic = "force-dynamic";

export default async function ScorerEvidencePage() {
  await requireStrategist();
  const [anglesResult, marketsResult] = await Promise.all([
    supabase.from("Angle").select("*").order("name"),
    supabase.from("MarketProfile").select("*").order("code"),
  ]);
  const error = anglesResult.error ?? marketsResult.error;
  if (error) throw new Error(error.message);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><Link href="/scorer" className="text-sm text-ink-500 hover:text-ink-900">← Script Scorer</Link><div className="mt-3 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Scorer evidence library</h1><span className="tag tag-warn">review queue</span></div><p className="mt-1 max-w-3xl text-sm text-ink-500">Import sourced rows, attach exact scripts, and review the evidence without changing the Google Sheet. Observed creatives do not become gold evidence automatically.</p></div>
      </header>
      <EvidenceLibraryClient
        angles={(anglesResult.data as AngleRow[]).map((angle) => ({ value: angle.slug, label: angle.name }))}
        markets={(marketsResult.data as MarketProfileRow[]).map((market) => ({ value: market.code.toUpperCase(), label: `${market.code.toUpperCase()} · ${market.name}` }))}
      />
    </div>
  );
}
