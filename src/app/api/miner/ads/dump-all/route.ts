import { getSessionUser } from "@/lib/auth";
import { dumpAdJson } from "@/lib/cellumove/corpus/dump.server";
import { loadAdTeardowns } from "@/lib/cellumove/corpus/teardown.server";
import { createZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";
// ~6 small queries per ad, 8 ads at a time: about 10s per 100 ads.
export const maxDuration = 300;

const LANES = 8;

/**
 * Every deconstructed ad as one ZIP: a JSON file per ad (the same document as the
 * single-ad download — transcript, beats and the full Teardown workbook), filed
 * under its brand, plus an index.json listing what is inside.
 */
export async function GET(): Promise<Response> {
  if (!(await getSessionUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const teardowns = (await loadAdTeardowns()).filter((row) => row.status === "completed");
    if (!teardowns.length) return Response.json({ error: "No ad has been deconstructed yet." }, { status: 404 });

    const dumps: Array<Record<string, unknown> | null> = new Array(teardowns.length).fill(null);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(LANES, teardowns.length) }, async () => {
      while (cursor < teardowns.length) {
        const index = cursor++;
        dumps[index] = await dumpAdJson(teardowns[index]!.competitorAdId, teardowns[index]);
      }
    }));

    const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
    const entries: ZipEntry[] = [];
    const index: Array<Record<string, unknown>> = [];
    for (const dump of dumps) {
      if (!dump) continue; // the ad row was deleted after it was deconstructed
      const ad = dump.ad as { id: string; brandName: string; winnerScore: number | null; formatTag: string | null; angleTag: string | null };
      const path = `${safe(ad.brandName)}/${safe(ad.id)}.json`;
      entries.push({ path, content: JSON.stringify(dump, null, 2) });
      index.push({ file: path, id: ad.id, brand: ad.brandName, winnerScore: ad.winnerScore, format: ad.formatTag, concept: ad.angleTag, beats: (dump.beats as unknown[]).length });
    }
    index.sort((a, b) => Number(b.winnerScore ?? 0) - Number(a.winnerScore ?? 0));
    const stamp = new Date().toISOString().slice(0, 10);
    entries.unshift({ path: "index.json", content: JSON.stringify({ exportedAt: new Date().toISOString(), ads: index.length, files: index }, null, 2) });

    // Streamed in chunks, not returned as one body: Vercel caps a buffered response
    // at 4.5 MB, and 93 ads already make 2.4 MB (the corpus grows by ~10 a day).
    // ponytail: the archive is still built in memory first; fine into the hundreds
    // of ads, stream entry-by-entry if it ever reaches thousands.
    const zip = createZip(entries);
    const CHUNK = 512 * 1024;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= zip.length) return controller.close();
        controller.enqueue(new Uint8Array(zip.subarray(sent, sent + CHUNK)));
        sent += CHUNK;
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="deconstructed-ads-${stamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
