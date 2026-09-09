import { getSessionUser } from "@/lib/auth";
import { getScriptScoreRun } from "@/lib/cellumove/script-scorer.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to view script scores." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can view script scores." }, { status: 403 });
  }
  try {
    const { runId } = await params;
    const result = await getScriptScoreRun(runId);
    return result ? Response.json(result) : Response.json({ error: "Score run not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

