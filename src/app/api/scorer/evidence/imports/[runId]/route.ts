import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to view evidence imports." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can view evidence imports." }, { status: 403 });
  const { runId } = await params;
  const result = await supabase.from("EvidenceImportRun").select("*").eq("id", runId).maybeSingle();
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  if (!result.data) return Response.json({ error: "Import run not found." }, { status: 404 });
  return Response.json({ run: result.data });
}
