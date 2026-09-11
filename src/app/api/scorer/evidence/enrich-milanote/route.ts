import { getSessionUser } from "@/lib/auth";
import { enrichAllMilanoteEvidence } from "@/lib/cellumove/milanote-enrichment.server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to import Milanote evidence." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can import Milanote evidence." }, { status: 403 });
  }
  try {
    const summary = await enrichAllMilanoteEvidence();
    return Response.json({ summary });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

