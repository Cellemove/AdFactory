"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, newId } from "@/lib/db";
import { summarizePerformance } from "@/lib/cellumove/performance";
import type { PerformanceEntryRow } from "@/lib/database.types";

// KPI ingestion for the Iterate lane. Each entry is one performance report for a
// winning ad (e.g. "last 7 days from Meta"). Multiple entries per winner are fine
// — the summary blends them.

const EntrySchema = z.object({
  winnerId: z.string().min(1),
  adName: z.string().min(1),
  spend: z.coerce.number().min(0),
  impressions: z.coerce.number().int().min(0).optional(),
  clicks: z.coerce.number().int().min(0).optional(),
  purchases: z.coerce.number().int().min(0).optional(),
  roas: z.coerce.number().min(0).optional().nullable(),
  ctr: z.coerce.number().min(0).optional().nullable(),
  cpa: z.coerce.number().min(0).optional().nullable(),
  date: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type AddPerformanceInput = z.input<typeof EntrySchema>;

export async function addPerformanceEntry(input: AddPerformanceInput): Promise<{ id: string }> {
  const p = EntrySchema.parse(input);
  const impressions = p.impressions ?? 0;
  const clicks = p.clicks ?? 0;
  const purchases = p.purchases ?? 0;
  // Derive CTR / CPA when they weren't entered but the raw counts allow it.
  const ctr = p.ctr ?? (impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null);
  const cpa = p.cpa ?? (purchases > 0 ? Number((p.spend / purchases).toFixed(2)) : null);

  const id = newId();
  const res = await supabase.from("PerformanceEntry").insert({
    id,
    winnerId: p.winnerId,
    adName: p.adName,
    spend: p.spend,
    impressions,
    clicks,
    purchases,
    roas: p.roas ?? null,
    ctr,
    cpa,
    date: p.date ? new Date(p.date).toISOString() : new Date().toISOString(),
    source: p.source?.trim() || "manual",
    notes: p.notes?.trim() || null,
    createdAt: new Date().toISOString(),
  });
  if (res.error) {
    if (/relation .*PerformanceEntry.* does not exist|schema cache/i.test(res.error.message)) {
      throw new Error("KPI table isn't set up yet — run migrations/006_performance_entries.sql in Supabase.");
    }
    throw new Error(res.error.message);
  }
  revalidatePath("/winners");
  return { id };
}

export async function deletePerformanceEntry(id: string): Promise<void> {
  const res = await supabase.from("PerformanceEntry").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/winners");
}

export async function listPerformanceForWinner(winnerId: string): Promise<PerformanceEntryRow[]> {
  const res = await supabase
    .from("PerformanceEntry")
    .select("*")
    .eq("winnerId", winnerId)
    .order("date", { ascending: false });
  return res.error ? [] : ((res.data ?? []) as PerformanceEntryRow[]);
}

// All entries grouped by winnerId — used by the Winners page to render KPIs inline.
export async function performanceByWinner(): Promise<Record<string, PerformanceEntryRow[]>> {
  const res = await supabase
    .from("PerformanceEntry")
    .select("*")
    .order("date", { ascending: false })
    .limit(1000);
  if (res.error) return {};
  const out: Record<string, PerformanceEntryRow[]> = {};
  for (const r of (res.data ?? []) as PerformanceEntryRow[]) {
    if (!r.winnerId) continue;
    (out[r.winnerId] ??= []).push(r);
  }
  return out;
}

/** Load + summarize a winner's KPIs. Fail-soft → null so iteration never breaks. */
export async function loadWinnerPerformanceSummary(winnerId: string): Promise<string | null> {
  try {
    const entries = await listPerformanceForWinner(winnerId);
    return summarizePerformance(entries);
  } catch {
    return null;
  }
}
