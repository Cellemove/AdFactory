import { getSessionUser } from "@/lib/auth";
import { buildDeconstructedAdsZip } from "@/lib/cellumove/corpus/dump-all.server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(): Promise<Response> {
  if (!(await getSessionUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const built = await buildDeconstructedAdsZip();
    if (!built) return Response.json({ error: "No ad has been deconstructed yet." }, { status: 404 });

    // Streamed in chunks, not returned as one body: Vercel caps a buffered response
    // at 4.5 MB, and ~180 ads already make about that.
    // ponytail: the archive is still built in memory first; fine into the hundreds
    // of ads, stream entry-by-entry if it ever reaches thousands.
    const { zip } = built;
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
        "Content-Disposition": `attachment; filename="deconstructed-ads-${new Date().toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
