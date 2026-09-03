import "server-only";

import type { ScriptDocument } from "@/lib/cellumove/script-studio";
import type { BrollClipRow, BrollSuggestionRow } from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";

function uniqueBroll(document: ScriptDocument): Array<{ clipId: string; name: string }> {
  const unique = new Map<string, { clipId: string; name: string }>();
  document.modules.forEach((module) => module.brollRefs.forEach((ref) => {
    if (ref.clipId) unique.set(ref.clipId, { clipId: ref.clipId, name: ref.name });
  }));
  return [...unique.values()];
}

async function incrementCounter(clipId: string, field: "timesSuggested" | "timesUsed"): Promise<void> {
  const result = await supabase.from("BrollClip").select("*").eq("id", clipId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const clip = result.data as BrollClipRow | null;
  if (!clip) return;
  const now = new Date().toISOString();
  const values = field === "timesSuggested"
    ? { timesSuggested: (clip.timesSuggested ?? 0) + 1, lastSuggestedAt: now }
    : { timesUsed: (clip.timesUsed ?? 0) + 1, lastUsedAt: now };
  const update = await supabase.from("BrollClip").update(values).eq("id", clipId);
  if (update.error) throw new Error(update.error.message);
}

export async function recordScriptBrollSuggestions(projectId: string, document: ScriptDocument): Promise<number> {
  const refs = uniqueBroll(document);
  if (!refs.length) return 0;
  const existingResult = await supabase.from("BrollSuggestion").select("*").eq("source", "script_studio").eq("refId", projectId).in("clipId", refs.map((ref) => ref.clipId));
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = new Set(((existingResult.data ?? []) as BrollSuggestionRow[]).map((row) => row.clipId));
  const fresh = refs.filter((ref) => !existing.has(ref.clipId));
  if (!fresh.length) return 0;
  const insert = await supabase.from("BrollSuggestion").insert(fresh.map((ref) => ({
    id: newId(), clipId: ref.clipId, clipName: ref.name, source: "script_studio", refId: projectId,
  })));
  if (insert.error) throw new Error(insert.error.message);
  for (const ref of fresh) await incrementCounter(ref.clipId, "timesSuggested");
  return fresh.length;
}

export async function recordConfirmedScriptBrollUse(projectId: string, clipId: string, clipName: string): Promise<boolean> {
  const existing = await supabase.from("BrollSuggestion").select("id").eq("source", "script_studio_used").eq("refId", projectId).eq("clipId", clipId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return false;
  const insert = await supabase.from("BrollSuggestion").insert({ id: newId(), clipId, clipName, source: "script_studio_used", refId: projectId });
  if (insert.error) throw new Error(insert.error.message);
  await incrementCounter(clipId, "timesUsed");
  return true;
}
