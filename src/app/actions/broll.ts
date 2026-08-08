"use server";

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { listBrollFromDrive } from "@/lib/drive";
import type { BrollClipRow } from "@/lib/database.types";

// Pull the latest clip list from Drive and reconcile it with our index: insert new
// clips, update changed ones, drop clips that vanished. Throws a clear message when
// Drive isn't configured yet.
export async function syncBroll(): Promise<{ added: number; updated: number; removed: number; total: number }> {
  const clips = await listBrollFromDrive();

  const existingRes = await supabase.from("BrollClip").select("*");
  if (existingRes.error) {
    if (/relation .*BrollClip.* does not exist|schema cache/i.test(existingRes.error.message)) {
      throw new Error("B-roll table isn't set up yet — run migrations/007_broll_clips.sql in Supabase.");
    }
    throw new Error(existingRes.error.message);
  }
  const existing = (existingRes.data ?? []) as BrollClipRow[];
  const byDriveId = new Map(existing.map((c) => [c.driveId, c]));

  const now = new Date().toISOString();
  const seenDriveIds = new Set<string>();
  const toInsert: BrollClipRow[] = [];
  let updated = 0;

  for (const c of clips) {
    seenDriveIds.add(c.driveId);
    const fields = {
      driveId: c.driveId,
      name: c.name,
      mimeType: c.mimeType,
      folderPath: c.folderPath || null,
      webViewLink: c.webViewLink,
      thumbnailLink: c.thumbnailLink,
      description: c.description,
      durationMs: c.durationMs,
      sizeBytes: c.sizeBytes,
      indexedAt: now,
    };
    const prior = byDriveId.get(c.driveId);
    if (prior) {
      const upd = await supabase.from("BrollClip").update(fields).eq("id", prior.id);
      if (!upd.error) updated++;
    } else {
      toInsert.push({ id: newId(), ...fields });
    }
  }

  let added = 0;
  if (toInsert.length) {
    const ins = await supabase.from("BrollClip").insert(toInsert);
    if (ins.error) throw new Error(ins.error.message);
    added = toInsert.length;
  }

  // Drop clips that no longer exist in Drive.
  let removed = 0;
  const stale = existing.filter((c) => !seenDriveIds.has(c.driveId)).map((c) => c.id);
  if (stale.length) {
    const del = await supabase.from("BrollClip").delete().in("id", stale);
    if (!del.error) removed = stale.length;
  }

  revalidatePath("/broll");
  return { added, updated, removed, total: clips.length };
}

// Fetch clips in pages of 1000 (PostgREST caps a single response), so large
// libraries return in full instead of being silently truncated.
export async function listBrollClips(limit = 2000): Promise<BrollClipRow[]> {
  const pageSize = 1000;
  const out: BrollClipRow[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize, limit) - 1;
    const res = await supabase
      .from("BrollClip")
      .select("*")
      .order("folderPath", { ascending: true })
      .order("name", { ascending: true })
      .range(from, to);
    if (res.error) break;
    const rows = (res.data ?? []) as BrollClipRow[];
    out.push(...rows);
    if (rows.length < to - from + 1) break; // last page reached
  }
  return out;
}

// A prompt block listing the real b-roll clips, so the Designer / Creative-Briefs
// stages can match beats to actual files instead of suggesting b-roll blind.
// Returns "" when nothing is indexed (fail-soft — the stage just runs without it).
export async function brollLibraryContext(max = 150): Promise<string> {
  let clips: BrollClipRow[] = [];
  try {
    clips = await listBrollClips(max);
  } catch {
    return "";
  }
  if (!clips.length) return "";
  const lines = clips.map((c) => {
    const dur = c.durationMs ? ` (${Math.round(c.durationMs / 1000)}s)` : "";
    const folder = c.folderPath ? ` [${c.folderPath}]` : "";
    const desc = c.description ? ` — ${c.description}` : "";
    return `  - ${c.name}${folder}${dur}${desc}`;
  });
  return [
    "AVAILABLE B-ROLL LIBRARY — real clips already in our Google Drive. Match beats to these by their EXACT name:",
    ...lines,
    "",
    "For each beat, prefer a clip from THIS library and reference it by its exact name. Only when no clip fits a beat, add what's needed to `missingClips` so we know to shoot it.",
  ].join("\n");
}
