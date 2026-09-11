import { after } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  createGoogleSheetImportRun,
  executeGoogleSheetEvidenceImport,
} from "@/lib/cellumove/evidence-import.server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to import scorer evidence." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can import scorer evidence." }, { status: 403 });
  try {
    const run = await createGoogleSheetImportRun(actor.id);
    after(() => executeGoogleSheetEvidenceImport(run.id));
    return Response.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
