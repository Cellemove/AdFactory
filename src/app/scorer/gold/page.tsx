import type { Metadata } from "next";
import Link from "next/link";
import { requireStrategist } from "@/lib/authorization";
import { supabase } from "@/lib/db";
import type { CopyTaxonomyCodeRow, GoldAdRow, GoldBeatRow, ScriptEvidenceRow } from "@/lib/database.types";
import { SCORER_BASELINE_VERSION, SCORER_TAXONOMY_VERSION } from "@/lib/cellumove/script-scorer";
import { GoldBaselineManager } from "./GoldBaselineManager";

export const metadata: Metadata = { title: "Gold Baseline · Script Scorer" };
export const dynamic = "force-dynamic";

export default async function GoldBaselinePage() {
  await requireStrategist();
  const [adsResult, beatsResult, candidatesResult, taxonomyResult] = await Promise.all([
    supabase.from("GoldAd").select("*").eq("baselineVersion", SCORER_BASELINE_VERSION).eq("taxonomyVersion", SCORER_TAXONOMY_VERSION).order("createdAt", { ascending: false }),
    supabase.from("GoldBeat").select("*").eq("taxonomyVersion", SCORER_TAXONOMY_VERSION).order("orderIndex"),
    supabase.from("ScriptEvidence").select("*").eq("evidenceLevel", "verified_winner").eq("reviewStatus", "approved").not("scriptText", "is", null).order("adDate", { ascending: false, nullsFirst: false }),
    supabase.from("CopyTaxonomyCode").select("*").eq("version", SCORER_TAXONOMY_VERSION).order("layer").order("code"),
  ]);
  const error = adsResult.error ?? beatsResult.error ?? candidatesResult.error ?? taxonomyResult.error;
  if (error) throw new Error(error.message);
  const beats = (beatsResult.data ?? []) as GoldBeatRow[];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><Link href="/scorer" className="text-sm text-ink-500 hover:text-ink-900">← Script Scorer</Link><div className="mt-3 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Gold baseline</h1><span className="tag tag-warn">provisional</span></div><p className="mt-1 max-w-3xl text-sm text-ink-500">Promote only verified winners, then code exact structural beats. A cohort needs at least five ads sharing an angle, preferably also a format.</p></div>
        <Link className="btn" href="/scorer/evidence">Review evidence →</Link>
      </header>
      <GoldBaselineManager
        ads={(adsResult.data ?? []) as GoldAdRow[]}
        beatCounts={Object.fromEntries((adsResult.data ?? []).map((ad) => [ad.id, beats.filter((beat) => beat.goldAdId === ad.id).length]))}
        candidates={(candidatesResult.data ?? []) as ScriptEvidenceRow[]}
        taxonomy={(taxonomyResult.data ?? []) as CopyTaxonomyCodeRow[]}
        baselineVersion={SCORER_BASELINE_VERSION}
      />
    </div>
  );
}
