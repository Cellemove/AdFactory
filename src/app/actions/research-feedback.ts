"use server";

import { revalidatePath } from "next/cache";
import { newId, supabase } from "@/lib/db";

const RATINGS = new Set(["useful", "generic", "incorrect", "duplicate", "used_in_script"]);

export async function submitResearchFeedback(input: {
  researchId: string;
  draftKey: string;
  evidenceId?: string | null;
  rating: string;
  note?: string | null;
}): Promise<void> {
  if (!input.researchId?.trim() || !input.draftKey?.trim()) throw new Error("Research feedback is missing its draft reference.");
  if (!RATINGS.has(input.rating)) throw new Error("Unknown research feedback rating.");
  const result = await supabase.from("ResearchFeedback").insert({
    id: newId(),
    researchId: input.researchId.trim(),
    draftKey: input.draftKey.trim(),
    evidenceId: input.evidenceId?.trim() || null,
    rating: input.rating,
    note: input.note?.trim().slice(0, 1000) || null,
    createdAt: new Date().toISOString(),
  });
  if (result.error) {
    if (/ResearchFeedback|schema cache|does not exist/i.test(result.error.message)) {
      throw new Error("Research feedback storage is not installed yet. Apply migration 011, then try again.");
    }
    throw new Error(result.error.message);
  }
  revalidatePath("/research");
  revalidatePath(`/research/${input.researchId}`);
}

