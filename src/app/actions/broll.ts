"use server";

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { listBrollFromDrive, downloadDriveFile } from "@/lib/drive";
import { getLLM } from "@/lib/llm";
import type { BrollClipRow, TablesInsert } from "@/lib/database.types";

type ClipWrite = TablesInsert<"BrollClip">;

// Pull the latest clip list from Drive and reconcile it with our index: insert new
// clips, update changed ones, drop clips that vanished. Throws a clear message when
// Drive isn't configured yet.
const CHUNK = 300;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncBroll(): Promise<{ added: number; updated: number; removed: number; total: number }> {
  const clips = await listBrollFromDrive();

  const probe = await supabase.from("BrollClip").select("id", { head: true, count: "exact" });
  if (probe.error) {
    if (/relation .*BrollClip.* does not exist|schema cache/i.test(probe.error.message)) {
      throw new Error("B-roll table isn't set up yet — run migrations/007_broll_clips.sql in Supabase.");
    }
    throw new Error(probe.error.message);
  }
  // Paged read — a single select() caps at 1000 rows, which would make large
  // libraries look mostly-missing and re-insert existing driveIds.
  const existing: BrollClipRow[] = await listBrollClips(50000);
  const byDriveId = new Map(existing.map((c) => [c.driveId, c]));

  const now = new Date().toISOString();
  const seenDriveIds = new Set<string>();
  const toInsert: ClipWrite[] = [];
  const toUpdate: ClipWrite[] = [];

  for (const c of clips) {
    if (seenDriveIds.has(c.driveId)) continue;
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
    if (!prior) {
      toInsert.push({ id: newId(), ...fields });
    } else if (
      // Rewrite only rows that actually changed. thumbnailLink's URL is excluded from
      // the comparison — Drive rotates those on every fetch, which would otherwise
      // force a full-table rewrite each sync — but a presence change (Drive finished
      // generating a preview) does count, so the UI's has-thumbnail hint stays fresh.
      Boolean(prior.thumbnailLink) !== Boolean(fields.thumbnailLink) ||
      prior.name !== fields.name ||
      prior.mimeType !== fields.mimeType ||
      prior.folderPath !== fields.folderPath ||
      prior.webViewLink !== fields.webViewLink ||
      prior.description !== fields.description ||
      prior.durationMs !== fields.durationMs ||
      prior.sizeBytes !== fields.sizeBytes
    ) {
      toUpdate.push({ id: prior.id, ...fields });
    }
  }

  for (const batch of chunks(toInsert, CHUNK)) {
    const ins = await supabase.from("BrollClip").insert(batch);
    if (ins.error) throw new Error(ins.error.message);
  }
  for (const batch of chunks(toUpdate, CHUNK)) {
    const upd = await supabase.from("BrollClip").upsert(batch, { onConflict: "driveId" });
    if (upd.error) throw new Error(upd.error.message);
  }

  // Drop clips that no longer exist in Drive.
  let removed = 0;
  const stale = existing.filter((c) => !seenDriveIds.has(c.driveId)).map((c) => c.id);
  for (const batch of chunks(stale, CHUNK)) {
    const del = await supabase.from("BrollClip").delete().in("id", batch);
    if (!del.error) removed += batch.length;
  }

  revalidatePath("/broll");
  return { added: toInsert.length, updated: toUpdate.length, removed, total: seenDriveIds.size };
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
// Evenly-spaced sample so the prompt sees the whole library, not one alphabetical corner.
function sampleAcross<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]!);
}

export async function brollLibraryContext(max = 300): Promise<string> {
  let clips: BrollClipRow[] = [];
  let libraryTotal = 0;
  try {
    clips = await listBrollClips(50000);
  } catch {
    return "";
  }
  // The Drive mixes raw b-roll with finished ad deliverables: keep trash out and
  // fill the prompt budget with dedicated b-roll/UGC folders first, other clips after.
  const usable = clips.filter((c) => !/trash/i.test(c.folderPath ?? ""));
  libraryTotal = usable.length;
  const isBroll = (c: BrollClipRow) => /b.?rolls?|ugc/i.test(c.folderPath ?? "");
  // Least-suggested first, so under-used footage gets sampled into the prompt —
  // the feedback loop that keeps the same clips from being recommended forever.
  const byFreshness = (a: BrollClipRow, b: BrollClipRow) =>
    (a.timesSuggested ?? 0) - (b.timesSuggested ?? 0);
  clips = [
    ...sampleAcross(usable.filter(isBroll).sort(byFreshness), max),
    ...sampleAcross(usable.filter((c) => !isBroll(c)).sort(byFreshness), Math.max(0, max - usable.filter(isBroll).length)),
  ].slice(0, max);
  if (!clips.length) return "";
  const lines = clips.map((c) => {
    const dur = c.durationMs ? ` (${Math.round(c.durationMs / 1000)}s)` : "";
    const folder = c.folderPath ? ` [${c.folderPath}]` : "";
    const desc = c.aiDescription || c.description ? ` — ${c.aiDescription ?? c.description}` : "";
    const tags = c.tags ? ` {${c.tags}}` : "";
    const used = (c.timesSuggested ?? 0) > 0 ? ` (suggested ${c.timesSuggested}×)` : "";
    return `  - ${c.name}${folder}${dur}${desc}${tags}${used}`;
  });
  return [
    `AVAILABLE B-ROLL LIBRARY — real clips already in our Google Drive (a representative sample of ${libraryTotal} indexed clips). Match beats to these by their EXACT name:`,
    ...lines,
    "",
    "For each beat, prefer a clip from THIS library and reference it by its exact name. Clips marked \"suggested N×\" have been recommended in past ads — when two clips fit equally, pick the one with the LOWER count (or no marker) so we don't overuse the same footage. Only when no clip fits a beat, add what's needed to `missingClips` so we know to shoot it.",
  ].join("\n");
}

// ─── Suggestion detection ────────────────────────────────────────────────────
// Scan a pipeline stage's raw JSON output for exact clip-name mentions and count
// them. Text-scan (not schema parse) so it works for both the Designer's
// brollByBeat and Creative-Briefs' shotList — and survives schema drift.
// Best-effort by design: a counting failure must never break a pipeline run.
export async function recordBrollSuggestions(
  outputText: string,
  source: "designer" | "creative_briefs",
  refId?: string,
): Promise<{ matched: number }> {
  try {
    const clips = await listBrollClips(50000);
    if (!clips.length || !outputText) return { matched: 0 };
    const hay = outputText.toLowerCase();
    const matched = clips.filter((c) => {
      const name = c.name.toLowerCase();
      // Length guards keep generic names ("1.mp4") from false-positive matching.
      if (name.length >= 6 && hay.includes(name)) return true;
      const stem = name.replace(/\.[a-z0-9]{2,4}$/, "");
      return stem.length >= 8 && stem !== name && hay.includes(stem);
    });
    if (!matched.length) return { matched: 0 };

    const now = new Date().toISOString();
    await supabase.from("BrollSuggestion").insert(
      matched.map((c) => ({
        id: newId(),
        clipId: c.id,
        clipName: c.name,
        source,
        refId: refId ?? null,
      })),
    );
    for (const c of matched) {
      await supabase
        .from("BrollClip")
        .update({ timesSuggested: (c.timesSuggested ?? 0) + 1, lastSuggestedAt: now })
        .eq("id", c.id);
    }
    return { matched: matched.length };
  } catch {
    return { matched: 0 };
  }
}

// Editors confirm a clip actually made it into a shipped ad ("count the broll we use").
export async function markClipUsed(clipId: string): Promise<{ timesUsed: number }> {
  const res = await supabase.from("BrollClip").select("*").eq("id", clipId).maybeSingle();
  if (res.error) throw new Error(friendly008(res.error.message));
  const clip = res.data as BrollClipRow | null;
  if (!clip) throw new Error("Clip not found — re-sync from Drive.");
  const timesUsed = (clip.timesUsed ?? 0) + 1;
  const upd = await supabase
    .from("BrollClip")
    .update({ timesUsed, lastUsedAt: new Date().toISOString() })
    .eq("id", clipId);
  if (upd.error) throw new Error(friendly008(upd.error.message));
  revalidatePath("/broll");
  return { timesUsed };
}

function friendly008(msg: string): string {
  return /column .* does not exist|schema cache/i.test(msg)
    ? "B-roll intelligence columns missing — run migrations/008_broll_intelligence.sql in Supabase."
    : msg;
}

// ─── Content analysis ("scrap the b-roll") ───────────────────────────────────
// Gemini watches each clip and writes a dense description + tags, so suggestions
// can match what's IN the footage instead of guessing from filenames. Batched —
// the button on /broll chews through the library a few clips at a time.
const ANALYZE_MAX_BYTES = 15 * 1024 * 1024; // inline-request budget for Vertex

export async function analyzeBroll(
  batch = 5,
): Promise<{ analyzed: number; skipped: number; failed: number; remaining: number; lastError: string | null }> {
  const pending = await supabase
    .from("BrollClip")
    .select("*")
    .is("analyzedAt", null)
    .order("sizeBytes", { ascending: true })
    .limit(400);
  if (pending.error) throw new Error(friendly008(pending.error.message));
  const rows = (pending.data ?? []) as BrollClipRow[];

  // Real b-roll folders first — same preference the prompt context uses.
  const isBroll = (c: BrollClipRow) => /b.?rolls?|ugc/i.test(c.folderPath ?? "");
  const candidates = [...rows.filter(isBroll), ...rows.filter((c) => !isBroll(c))];

  let analyzed = 0;
  let skipped = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const clip of candidates) {
    if (analyzed + skipped >= batch) break;

    // Too big (or size unknown) for inline analysis: mark as visited so the batch
    // walker doesn't re-hit it forever. It simply stays description-less.
    if (!clip.sizeBytes || clip.sizeBytes > ANALYZE_MAX_BYTES) {
      await supabase.from("BrollClip").update({ analyzedAt: new Date().toISOString() }).eq("id", clip.id);
      skipped++;
      continue;
    }

    try {
      const bytes = await downloadDriveFile(clip.driveId);
      const llm = getLLM();
      const resp = await llm.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: clip.mimeType, data: bytes.toString("base64") } },
              {
                text: [
                  "You are indexing a b-roll library for CelluMove (compression shaping leggings ads).",
                  "Watch this clip and return ONLY JSON:",
                  '{"description": "<ONE dense sentence: subject, action, setting, framing, mood>",',
                  ' "tags": ["5-10 short lowercase tags: body part, action, setting, shot type, mood, product-visible or no-product"]}',
                ].join("\n"),
              },
            ],
          },
        ],
        config: { responseMimeType: "application/json", temperature: 0.2 },
      });
      const parsed = JSON.parse(resp.text ?? "{}") as { description?: string; tags?: string[] };
      const upd = await supabase
        .from("BrollClip")
        .update({
          aiDescription: parsed.description?.slice(0, 500) ?? null,
          tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 12).join(", ").slice(0, 300) : null,
          analyzedAt: new Date().toISOString(),
        })
        .eq("id", clip.id);
      if (upd.error) throw new Error(friendly008(upd.error.message));
      analyzed++;
    } catch (e) {
      // Transient failures stay unmarked so a later batch retries them.
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
      if (/migrations\/008/.test(lastError)) throw new Error(lastError);
    }
  }

  const remain = await supabase
    .from("BrollClip")
    .select("id", { head: true, count: "exact" })
    .is("analyzedAt", null);
  revalidatePath("/broll");
  return { analyzed, skipped, failed, remaining: remain.count ?? 0, lastError };
}

// ─── Paged listing for the /broll page ───────────────────────────────────────
// Search + sort + pagination happen in the database, so the page ships ~60 rows
// no matter how large the library grows (7k+ clips with AI descriptions would
// otherwise be a multi-MB payload).
export interface BrollPageData {
  clips: BrollClipRow[];
  total: number; // clips matching the current search
  pageCount: number;
  indexedTotal: number;
  analyzedTotal: number;
  suggestionsTotal: number;
}

export async function searchBrollClips(opts: {
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<BrollPageData> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 60, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  // Commas/parens would break PostgREST's or() filter syntax — strip them.
  const q = (opts.q ?? "").trim().replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  const sort = opts.sort ?? "analyzed";
  const from = (page - 1) * pageSize;

  // rich=false is the pre-migration-008 fallback (no analysis/counter columns).
  const attempt = (rich: boolean) => {
    let query = supabase.from("BrollClip").select("*", { count: "exact" });
    if (q) {
      const pat = `%${q}%`;
      query = query.or(
        rich
          ? `name.ilike.${pat},folderPath.ilike.${pat},aiDescription.ilike.${pat},tags.ilike.${pat}`
          : `name.ilike.${pat},folderPath.ilike.${pat}`,
      );
    }
    if (rich && sort === "analyzed") {
      query = query.order("analyzedAt", { ascending: false, nullsFirst: false });
    } else if (rich && sort === "most-suggested") {
      query = query.order("timesSuggested", { ascending: false });
    } else if (rich && sort === "least-suggested") {
      query = query.order("timesSuggested", { ascending: true });
    } else if (rich && sort === "most-used") {
      query = query.order("timesUsed", { ascending: false });
    }
    // Stable tiebreaker (and the whole order for "folder" / fallback mode).
    query = query.order("folderPath", { ascending: true }).order("name", { ascending: true });
    return query.range(from, from + pageSize - 1);
  };

  let res = await attempt(true);
  if (res.error && /column .* does not exist|schema cache/i.test(res.error.message)) {
    res = await attempt(false);
  }
  if (res.error) throw new Error(res.error.message);
  const total = res.count ?? 0;

  const [indexedRes, analyzedRes, suggRes] = await Promise.all([
    supabase.from("BrollClip").select("id", { head: true, count: "exact" }),
    supabase.from("BrollClip").select("id", { head: true, count: "exact" }).not("analyzedAt", "is", null),
    supabase.from("BrollSuggestion").select("id", { head: true, count: "exact" }),
  ]);

  return {
    clips: (res.data ?? []) as BrollClipRow[],
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    indexedTotal: indexedRes.count ?? 0,
    analyzedTotal: analyzedRes.count ?? 0, // 0 when 008 isn't applied yet
    suggestionsTotal: suggRes.count ?? 0,
  };
}
