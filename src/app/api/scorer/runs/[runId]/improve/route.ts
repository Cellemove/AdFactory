import { getSessionUser } from "@/lib/auth";
import { proposeScoreImprovement } from "@/lib/cellumove/script-scorer.server";

export const dynamic = "force-dynamic";
// One Pro edit plus a full re-score per attempt, up to two attempts.
export const maxDuration = 300;

// Proposes an AI edit that raises this run's scores and proves it by re-scoring.
// Saves nothing: the client applies an accepted edit as unsaved changes.
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to improve a script." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can improve scripts." }, { status: 403 });
  }
  try {
    const { runId } = await params;
    return Response.json(await proposeScoreImprovement({ runId, actor }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
