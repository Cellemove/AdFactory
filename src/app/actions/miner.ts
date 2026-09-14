"use server";

import { revalidatePath } from "next/cache";
import { requireStrategist } from "@/lib/authorization";
import { markExtractReviewed } from "@/lib/cellumove/corpus/state.server";

/** Close a quarantined extraction after a human has looked at it. Writes no beats. */
export async function markCorpusExtractReviewed(formData: FormData): Promise<void> {
  const user = await requireStrategist();
  const runId = String(formData.get("runId") ?? "").trim();
  const adId = String(formData.get("adId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid run id.");
  await markExtractReviewed(runId, user.id, note);
  revalidatePath("/miner");
  if (adId) revalidatePath(`/miner/${adId}`);
}
