import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ScriptDocumentSchema, parseScriptDocument } from "@/lib/cellumove/script-studio";
import { proposeWorkflowFix } from "@/lib/cellumove/script-workflow-audit.server";
import type { ScriptProjectRow, ScriptWorkflowAuditRunRow, ScriptWorkflowFindingRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RequestSchema = z.object({
  auditRunId: z.string().min(1),
  findingIds: z.array(z.string().min(1)).min(1).max(40),
  expectedRevision: z.number().int().nonnegative(),
  document: ScriptDocumentSchema,
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to fix scripts." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can apply Workflow fixes." }, { status: 403 });
  const { id } = await params;
  let body: z.infer<typeof RequestSchema>;
  try { body = RequestSchema.parse(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid fix request." }, { status: 400 }); }

  const [projectResult, auditResult, findingsResult] = await Promise.all([
    supabase.from("ScriptProject").select("*").eq("id", id).maybeSingle(),
    supabase.from("ScriptWorkflowAuditRun").select("*").eq("id", body.auditRunId).eq("projectId", id).maybeSingle(),
    supabase.from("ScriptWorkflowFinding").select("*").eq("runId", body.auditRunId).in("id", [...new Set(body.findingIds)]),
  ]);
  const project = projectResult.data as ScriptProjectRow | null;
  const auditRun = auditResult.data as ScriptWorkflowAuditRunRow | null;
  const findings = (findingsResult.data ?? []) as ScriptWorkflowFindingRow[];
  if (!project) return Response.json({ error: "Script project not found." }, { status: 404 });
  if (!auditRun || auditRun.status !== "complete") return Response.json({ error: "The selected Workflow audit is unavailable." }, { status: 404 });
  if (findings.length !== new Set(body.findingIds).size) return Response.json({ error: "One or more selected findings are unavailable." }, { status: 400 });

  try {
    const document = parseScriptDocument(body.document);
    const modules = await proposeWorkflowFix({ project, document, expectedRevision: body.expectedRevision, auditRun, findings });
    const beforeById = new Map(document.modules.map((module) => [module.id, module]));
    return Response.json({
      patches: modules.map((after) => {
        const before = beforeById.get(after.id)!;
        return {
          id: after.id,
          before: { spokenText: before.spokenText, onScreenText: before.onScreenText, visualDirection: before.visualDirection },
          after,
        };
      }),
      promptVersion: "script-workflow-fix-v1",
      unsaved: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: /changed|no longer matches|stale/i.test(message) ? 409 : 500 });
  }
}
