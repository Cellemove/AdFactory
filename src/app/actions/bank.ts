"use server";

// ─── IDEA BANK / SWIPE FILE ──────────────────────────────────────────────────
// Spy sweeps are throwaway: each writes a Research row holding a JSON array of
// creatives, and the only curation is deleting entries from that blob. These
// actions back the durable side — the ads a strategist chose to KEEP, annotated
// and tracked through a small workflow, surviving the sweep they came from.
//
// Everything here fails soft when Migration 012 hasn't been applied yet, so the
// Spy page keeps working and the /bank page shows a "run the migration" hint
// instead of a crash.

// NOTE: this is a "use server" module, so it may only export ASYNC FUNCTIONS.
// Shared constants and sync helpers live in @/lib/bank — exporting them from
// here fails the build with "Server Actions must be async functions".

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { requireUser } from "@/lib/authorization";
import { isBankStatus } from "@/lib/bank";
import type { BankedAdRow } from "@/lib/database.types";
import type { SpyAd } from "./spy";

/** PostgREST's code for "table isn't in the schema cache" — i.e. not migrated. */
const TABLE_MISSING = "PGRST205";

function isTableMissing(error: { code?: string } | null): boolean {
  return error?.code === TABLE_MISSING;
}

export interface BankListResult {
  items: BankedAdRow[];
  /** True when Migration 012 hasn't been run — the UI shows setup instructions. */
  needsMigration: boolean;
}

/** Everything in the bank, newest first. Fail-soft on a missing table. */
export async function listBankedAds(): Promise<BankListResult> {
  const res = await supabase
    .from("BankedAd")
    .select("*")
    .order("createdAt", { ascending: false });
  if (res.error) {
    if (isTableMissing(res.error)) return { items: [], needsMigration: true };
    throw new Error(res.error.message);
  }
  return { items: (res.data ?? []) as BankedAdRow[], needsMigration: false };
}

/**
 * Keep one creative from a sweep. Idempotent: sourceUrl is uniquely indexed, so
 * re-saving the same ad refreshes its snapshot rather than duplicating it — but
 * it deliberately does NOT clobber the note or status the user already set.
 */
export async function saveToBank(ad: SpyAd, sweepId?: string | null): Promise<{ saved: boolean; reason?: string }> {
  const user = await requireUser();
  const sourceUrl = (ad.sourceUrl || ad.imageUrl || "").trim();
  if (!sourceUrl) return { saved: false, reason: "This creative has no source link to save." };

  const existing = await supabase
    .from("BankedAd")
    .select("id")
    .eq("sourceUrl", sourceUrl)
    .maybeSingle();
  if (existing.error && !isTableMissing(existing.error)) {
    throw new Error(existing.error.message);
  }
  if (existing.error && isTableMissing(existing.error)) {
    return { saved: false, reason: "Run migration 012_banked_ads.sql first — the BankedAd table doesn't exist yet." };
  }

  const now = new Date().toISOString();
  if (existing.data) {
    // Already banked. Refresh the creative snapshot only; leave note/status alone.
    const upd = await supabase
      .from("BankedAd")
      .update({
        brand: ad.brand ?? "",
        hook: ad.caption ?? "",
        imageUrl: ad.imageUrl || null,
        platform: ad.platform || null,
        mediaType: ad.mediaType ?? "image",
        updatedAt: now,
      })
      .eq("id", (existing.data as { id: string }).id);
    if (upd.error) throw new Error(upd.error.message);
    revalidatePath("/bank");
    return { saved: true, reason: "Already in the bank — refreshed it." };
  }

  const ins = await supabase.from("BankedAd").insert({
    id: newId(),
    brand: ad.brand ?? "",
    hook: ad.caption ?? "",
    imageUrl: ad.imageUrl || null,
    platform: ad.platform || null,
    sourceUrl,
    mediaType: ad.mediaType ?? "image",
    note: null,
    status: "new",
    sweepId: sweepId ?? null,
    savedBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  if (ins.error) throw new Error(ins.error.message);
  revalidatePath("/bank");
  return { saved: true };
}

/** Edit the strategist's own fields: the note and the workflow status. */
export async function updateBankedAd(
  id: string,
  patch: { note?: string; status?: string },
): Promise<void> {
  await requireUser();
  if (!id) throw new Error("Missing id.");
  const update: Partial<BankedAdRow> = { updatedAt: new Date().toISOString() };
  if (patch.note !== undefined) update.note = patch.note.trim() || null;
  if (patch.status !== undefined) {
    if (!isBankStatus(patch.status)) throw new Error(`Unknown status: ${patch.status}`);
    update.status = patch.status;
  }
  const res = await supabase.from("BankedAd").update(update).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/bank");
}

/** Drop an entry from the bank entirely. */
export async function deleteBankedAd(id: string): Promise<void> {
  await requireUser();
  if (!id) throw new Error("Missing id.");
  const res = await supabase.from("BankedAd").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/bank");
}

/** Source URLs already banked — lets the Spy grid mark tiles as saved. */
export async function bankedSourceUrls(): Promise<string[]> {
  const res = await supabase.from("BankedAd").select("sourceUrl");
  if (res.error) return []; // fail soft: pre-migration, nothing is banked
  return (res.data ?? []).map((r) => (r as { sourceUrl: string }).sourceUrl);
}
