"use server";

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { extractWinnerEnrichment } from "@/lib/cellumove/sheet-winner-enrich";
import {
  fetchSheetCsv,
  buildSheetWinnersDoc,
  sheetWinnerKey,
  type SheetWinnersDoc,
  type SheetWinnerEnrichment,
} from "@/lib/cellumove/sheet-winners";

// The imported winning-ads set is persisted as ONE Research row (zero-migration
// trick — same as the pipeline/spy pages). type tags it; drafts holds the JSON doc.
const RESEARCH_TYPE = "sheet_winners";

async function loadRow(): Promise<{ id: string; doc: SheetWinnersDoc } | null> {
  const res = await supabase
    .from("Research")
    .select("id, drafts")
    .eq("type", RESEARCH_TYPE)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  try {
    const row = res.data as { id: string; drafts: string };
    return { id: row.id, doc: JSON.parse(row.drafts) as SheetWinnersDoc };
  } catch {
    return null;
  }
}

async function saveDoc(id: string, doc: SheetWinnersDoc): Promise<void> {
  const upd = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(doc) })
    .eq("id", id);
  if (upd.error) throw new Error(upd.error.message);
}

// Fetch the live Google Sheet, filter to winning ads, and replace the stored set.
// Re-runnable — a fresh import replaces the list but CARRIES OVER any creative
// enrichment already extracted (keyed by market|adName|postLink).
export async function importSheetWinners(): Promise<{
  total: number;
  importedAt: string;
  byMarket: { market: string; count: number }[];
}> {
  const csv = await fetchSheetCsv();
  const doc = buildSheetWinnersDoc(csv);

  const prior = await loadRow();
  if (prior) {
    const enriched = new Map(
      prior.doc.winners.filter((w) => w.enrichment).map((w) => [sheetWinnerKey(w), w.enrichment!]),
    );
    for (const w of doc.winners) {
      const e = enriched.get(sheetWinnerKey(w));
      if (e) w.enrichment = e;
    }
  }

  // Keep exactly one row: drop any prior import, then insert the fresh one.
  const del = await supabase.from("Research").delete().eq("type", RESEARCH_TYPE);
  if (del.error) throw new Error(del.error.message);
  const ins = await supabase.from("Research").insert({
    id: newId(),
    type: RESEARCH_TYPE,
    angleSlug: null,
    focus: null,
    drafts: JSON.stringify(doc),
    status: "imported",
    createdAt: new Date().toISOString(),
  });
  if (ins.error) throw new Error(ins.error.message);

  revalidatePath("/winners");
  return { total: doc.total, importedAt: doc.importedAt, byMarket: doc.byMarket };
}

// Read the stored winning-ads doc (null if nothing has been imported yet).
export async function getSheetWinnersDoc(): Promise<SheetWinnersDoc | null> {
  const row = await loadRow();
  return row?.doc ?? null;
}

// ─── Creative enrichment ─────────────────────────────────────────────────────
// "See" an imported winner: fetch its FB post, persist the creative image, and
// have Gemini extract the same fields the curated Winners library holds. The
// heavy lifting lives in lib/cellumove/sheet-winner-enrich (shared with the
// batch script); this action owns doc load/merge/save + revalidation.

export async function enrichSheetWinner(key: string): Promise<SheetWinnerEnrichment> {
  const row = await loadRow();
  if (!row) throw new Error("No imported winners found — import from the sheet first.");
  const winner = row.doc.winners.find((w) => sheetWinnerKey(w) === key);
  if (!winner) throw new Error("Winner not found in the imported set (re-import may have changed it).");
  if (winner.enrichment) return winner.enrichment; // idempotent — already analyzed

  const enrichment = await extractWinnerEnrichment(winner);

  // Merge into the FRESHEST doc (another enrichment may have landed meanwhile).
  const fresh = await loadRow();
  if (!fresh) throw new Error("Imported winners disappeared during analysis.");
  const target = fresh.doc.winners.find((w) => sheetWinnerKey(w) === key);
  if (target) {
    target.enrichment = enrichment;
    await saveDoc(fresh.id, fresh.doc);
  }

  revalidatePath("/winners");
  return enrichment;
}
