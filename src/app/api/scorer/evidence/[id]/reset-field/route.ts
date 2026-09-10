import { getSessionUser } from "@/lib/auth";
import { ResetEvidenceFieldSchema } from "@/lib/cellumove/evidence-library";
import {
  EvidenceConflictError,
  EvidenceValidationError,
  resetEvidenceField,
} from "@/lib/cellumove/evidence-library.server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to edit scorer evidence." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can edit scorer evidence." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const parsed = ResetEvidenceFieldSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid reset request." }, { status: 422 });
  const { id } = await params;
  try {
    const item = await resetEvidenceField(id, parsed.data.expectedUpdatedAt, parsed.data.field);
    return Response.json({ item });
  } catch (error) {
    const status = error instanceof EvidenceConflictError ? 409 : error instanceof EvidenceValidationError ? 422 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
