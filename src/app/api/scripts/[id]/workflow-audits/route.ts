import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ScriptDocumentSchema, parseScriptDocument } from "@/lib/cellumove/script-studio";
import { runScriptWorkflowAudit } from "@/lib/cellumove/script-workflow-audit.server";
import { hashWorkflowDocument } from "@/lib/cellumove/script-workflow-hash";
import type { ScriptProjectRow, ScriptVersionRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RequestSchema = z.object({
  document: ScriptDocumentSchema,
  expectedRevision: z.number().int().nonnegative(),
  scriptVersion: z.number().int().positive().nullable().optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to audit scripts." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can audit scripts." }, { status: 403 });
  const { id } = await params;
  let body: z.infer<typeof RequestSchema>;
  try { body = RequestSchema.parse(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid audit request." }, { status: 400 }); }

  const projectResult = await supabase.from("ScriptProject").select("*").eq("id", id).maybeSingle();
  const project = projectResult.data as ScriptProjectRow | null;
  if (!project) return Response.json({ error: "Script project not found." }, { status: 404 });
  if (project.revision !== body.expectedRevision) return Response.json({ error: "This script changed in another session. Reload before auditing." }, { status: 409 });
  const document = parseScriptDocument(body.document);
  if (document.product.id !== project.productId || document.angle.id !== project.angleId) return Response.json({ error: "The open document does not match this project." }, { status: 400 });

  let scriptVersion: number | null = null;
  if (body.scriptVersion != null) {
    const versionResult = await supabase.from("ScriptVersion").select("*").eq("projectId", id).eq("version", body.scriptVersion).maybeSingle();
    const version = versionResult.data as ScriptVersionRow | null;
    if (!version || hashWorkflowDocument(parseScriptDocument(version.document)) !== hashWorkflowDocument(document)) {
      return Response.json({ error: "The requested immutable version does not match the open draft." }, { status: 409 });
    }
    scriptVersion = version.version;
  }

  try {
    return Response.json(await runScriptWorkflowAudit({ project, document, revision: body.expectedRevision, scriptVersion, actorUserId: actor.id }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
