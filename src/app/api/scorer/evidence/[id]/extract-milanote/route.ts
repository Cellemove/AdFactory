import { getSessionUser } from "@/lib/auth";
import { getJsonStringArray } from "@/lib/cellumove/evidence-library";
import { extractMilanoteScriptFromPdf } from "@/lib/cellumove/milanote-script-extraction.server";
import { getEvidenceRecord } from "@/lib/cellumove/evidence-library.server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await authorize();
  if (denied) return denied;

  const { id } = await params;
  const evidence = await getEvidenceRecord(id);
  if (!evidence) return Response.json({ error: "Evidence record not found." }, { status: 404 });
  if (!getJsonStringArray(evidence.sourceTypes).includes("milanote")) {
    return Response.json({ error: "This evidence entry does not have a Milanote source link." }, { status: 422 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Upload a Milanote PDF export." }, { status: 400 });
  }

  const expectedUpdatedAt = formData.get("expectedUpdatedAt");
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt !== evidence.updatedAt) {
    return Response.json({ error: "This evidence entry changed after you opened it. Reload it before extracting." }, { status: 409 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a Milanote PDF export." }, { status: 422 });

  try {
    const extraction = await extractMilanoteScriptFromPdf(file);
    return Response.json({ extraction });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

async function authorize(): Promise<Response | null> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to use scorer evidence." }, { status: 401 });
  return actor.role === "creative_strategist" ? null : Response.json({ error: "Only creative strategists can use scorer evidence." }, { status: 403 });
}
