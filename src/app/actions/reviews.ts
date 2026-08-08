"use server";

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { EditorClaimRow } from "@/lib/database.types";

const STATUSES = ["pending", "changes_requested", "approved"] as const;

async function loadClaim(claimId: string): Promise<EditorClaimRow | null> {
  const res = await supabase.from("EditorClaim").select("*").eq("id", claimId).maybeSingle();
  return res.error ? null : (res.data as EditorClaimRow | null);
}

/** Editor claims a completed pipeline run (one claim per run). */
export async function claimRun(runId: string, label: string): Promise<void> {
  const me = await getSessionUser();
  if (!me) throw new Error("Not signed in.");
  if (!runId) throw new Error("Missing run.");
  const existing = await supabase.from("EditorClaim").select("id").eq("runId", runId).maybeSingle();
  if (!existing.error && existing.data) throw new Error("This package is already claimed.");
  const now = new Date().toISOString();
  const res = await supabase.from("EditorClaim").insert({
    id: newId(),
    runId,
    label: label || "Creative package",
    claimedByEmail: me.username,
    reviewStatus: "pending",
    claimedAt: now,
    updatedAt: now,
  });
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/reviews");
}

/** Editor attaches the link to their delivered work. */
export async function setDelivery(claimId: string, url: string): Promise<void> {
  const me = await getSessionUser();
  if (!me) throw new Error("Not signed in.");
  const claim = await loadClaim(claimId);
  if (!claim) throw new Error("Claim not found.");
  if (claim.claimedByEmail !== me.username) throw new Error("That isn't your claim.");
  const res = await supabase
    .from("EditorClaim")
    .update({ deliveryUrl: url.trim() || null, updatedAt: new Date().toISOString() })
    .eq("id", claimId);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/reviews");
}

/** Creative Strategist leaves a review on a claim. Editors cannot. */
export async function submitReview(claimId: string, note: string, status: string): Promise<void> {
  const me = await getSessionUser();
  if (!me) throw new Error("Not signed in.");
  if (me.role !== "creative_strategist") throw new Error("Only a Creative Strategist can review.");
  const s = (STATUSES as readonly string[]).includes(status) ? status : "pending";
  const res = await supabase
    .from("EditorClaim")
    .update({
      reviewNote: note.trim() || null,
      reviewStatus: s,
      reviewedByEmail: me.username,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/reviews");
}

/** Release a claim — the owning editor, or any strategist. */
export async function releaseClaim(claimId: string): Promise<void> {
  const me = await getSessionUser();
  if (!me) throw new Error("Not signed in.");
  const claim = await loadClaim(claimId);
  if (!claim) return;
  if (me.role !== "creative_strategist" && claim.claimedByEmail !== me.username) {
    throw new Error("Not allowed.");
  }
  const res = await supabase.from("EditorClaim").delete().eq("id", claimId);
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/reviews");
}
