import { getSessionUser } from "@/lib/auth";
import type { ScriptWorkflowAuditRunRow, ScriptWorkflowFindingRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to view script audits." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can view script audits." }, { status: 403 });
  const { id } = await params;
  const runResult = await supabase.from("ScriptWorkflowAuditRun").select("*").eq("projectId", id).order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (runResult.error) return Response.json({ error: runResult.error.message }, { status: 500 });
  const run = runResult.data as ScriptWorkflowAuditRunRow | null;
  if (!run) return Response.json({ run: null, findings: [] });
  const findingResult = await supabase.from("ScriptWorkflowFinding").select("*").eq("runId", run.id).order("createdAt");
  if (findingResult.error) return Response.json({ error: findingResult.error.message }, { status: 500 });
  return Response.json({ run, findings: (findingResult.data ?? []) as ScriptWorkflowFindingRow[] });
}
