import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/db";
import { EvidenceUpdateRequestSchema } from "@/lib/cellumove/evidence-library";
import {
  EvidenceConflictError,
  EvidenceValidationError,
  getEvidenceRecord,
  updateEvidenceRecord,
} from "@/lib/cellumove/evidence-library.server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await authorize();
  if (denied) return denied;
  const { id } = await params;
  try {
    const item = await getEvidenceRecord(id);
    if (!item) return Response.json({ error: "Evidence record not found." }, { status: 404 });
    const revisions = await supabase.from("ScriptEvidenceRevision").select("*").eq("evidenceId", id).order("importedAt", { ascending: false }).limit(50);
    if (revisions.error) return Response.json({ error: revisions.error.message }, { status: 500 });
    return Response.json({ item, revisions: revisions.data ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await authorize();
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const parsed = EvidenceUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid evidence update." }, { status: 422 });
  const { id } = await params;
  try {
    const item = await updateEvidenceRecord(id, parsed.data.expectedUpdatedAt, parsed.data.patch);
    return Response.json({ item });
  } catch (error) {
    const status = error instanceof EvidenceConflictError ? 409 : error instanceof EvidenceValidationError ? 422 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

async function authorize(): Promise<Response | null> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to use scorer evidence." }, { status: 401 });
  return actor.role === "creative_strategist" ? null : Response.json({ error: "Only creative strategists can use scorer evidence." }, { status: 403 });
}
