import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/db";
import { accessibleAnalysis, createReference, referenceCapabilities, referenceDetail, referenceRequest, ReferenceRequestError, referenceView, saveReference, syncReference } from "@/lib/cellumove/reference-analysis.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: Context) {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to analyze reference ads." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can access reference analyses." }, { status: 403 });
  const path = (await context.params).path ?? [];
  const post = request.method === "POST";
  try {
    if (post) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== new URL(request.url).host && new URL(origin).host !== request.headers.get("host")) return Response.json({ error: "Cross-origin writes are not allowed." }, { status: 403 });
      if (Number(request.headers.get("content-length") ?? 0) > 100_000) throw new ReferenceRequestError("Request is too large.", 413);
    }
    if (!post && path[0] === "capabilities" && path.length === 1) return Response.json(await referenceCapabilities());
    if (!path.length) {
      if (post) return Response.json(await createReference(actor.id, await request.json()));
      const rows = unwrap(await supabase.from("ReferenceAnalysis").select("*").eq("createdByUserId", actor.id).order("createdAt", { ascending: false }).limit(30));
      return Response.json(rows.map(row => ({ ...referenceView({ ...row, result: null }), result: null })));
    }
    if (path.length > 2) throw new ReferenceRequestError("Unknown operation.", 404);
    const operation = path[1];
    const row = await accessibleAnalysis(path[0]!, actor.id, post);
    if (!post && !operation) return Response.json(await referenceDetail(await syncReference(row)));
    if (!post && operation === "playback") return Response.json(z.object({ url: z.string().url() }).parse(await referenceRequest(`/${row.teardownJobId}/playback`)));
    if (post && operation === "save") {
      const saved = await saveReference(await syncReference(row), actor.id, await request.json());
      revalidatePath("/scripts/new"); revalidatePath("/knowledge");
      return Response.json({ id: saved.id, name: saved.name, duration: saved.optimalDurationSec, extracted: true, referenceAnalysisId: row.id });
    }
    if (post && operation === "upload") {
      // Re-create remote metadata if a previous create request lost its response.
      await referenceRequest("", { id: row.id, source: row.source });
      return Response.json(z.object({ upload_url: z.string().url() }).parse(await referenceRequest(`/${row.teardownJobId}/upload`, { origin: request.headers.get("origin") ?? new URL(request.url).origin })));
    }
    if (post && (operation === "submit" || operation === "retry")) return Response.json(referenceView(await syncReference(row, await referenceRequest(`/${row.teardownJobId}/${operation}`, {}))));
    throw new ReferenceRequestError("Unknown operation.", 404);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "The analysis data did not pass validation. " + (error.issues[0]?.message ?? "") }, { status: 422 });
    const message = error instanceof ReferenceRequestError ? error.message : "Reference analysis could not be loaded. Please try again.";
    if (!(error instanceof ReferenceRequestError)) console.error("reference_analysis_request_failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: message }, { status: error instanceof ReferenceRequestError ? error.status : 500 });
  }
}
export const GET = handle;
export const POST = handle;
