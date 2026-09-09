import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { createScriptScoreRun } from "@/lib/cellumove/script-scorer.server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const CreateScoreRunSchema = z.object({
  projectId: z.string().min(1),
  scriptVersion: z.number().int().positive(),
  marketCode: z.string().trim().min(2).max(12).regex(/^[a-zA-Z0-9-]+$/).transform((value) => value.toUpperCase()),
  force: z.boolean().optional().default(false),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to score scripts." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can score Script Studio versions." }, { status: 403 });
  }
  let input: z.infer<typeof CreateScoreRunSchema>;
  try {
    input = CreateScoreRunSchema.parse(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid scorer request." }, { status: 400 });
  }
  try {
    const result = await createScriptScoreRun({ ...input, actor });
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const setupRequired = /ScriptScoreRun|CopyTaxonomyCode|schema cache|relation .* does not exist/i.test(message);
    return Response.json({ error: setupRequired ? "Apply migrations/015_script_scorer.sql before running the scorer." : message }, { status: setupRequired ? 503 : 500 });
  }
}

