import { getSessionUser } from "@/lib/auth";
import { dumpAdJson } from "@/lib/cellumove/corpus/dump.server";

export const dynamic = "force-dynamic";

/** One ad, fully decomposed, as a downloadable JSON file (same output as miner:dump-ad). */
export async function GET(_request: Request, { params }: { params: Promise<{ adId: string }> }): Promise<Response> {
  if (!(await getSessionUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { adId } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(adId)) return Response.json({ error: "Invalid ad id." }, { status: 400 });
  const dump = await dumpAdJson(adId);
  if (!dump) return Response.json({ error: "Ad not found." }, { status: 404 });
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${adId}.json"`,
    },
  });
}
