import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { AD_STAGES } from "@/lib/cellumove/corpus/queue";
import { runAdStep, runMine, runScore, runWinners, stageQueue, syncTeardowns } from "@/lib/cellumove/corpus/runner.server";

export const dynamic = "force-dynamic";
// One ad per call keeps each request far below this; collecting winners is the long one.
export const maxDuration = 600;

const adId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80);

const RunRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("queue"),
    stage: z.enum(AD_STAGES),
    limit: z.number().int().positive().max(1000).nullable().optional(),
    force: z.boolean().optional(),
    retryReview: z.boolean().optional(),
  }).strict(),
  z.object({
    action: z.literal("step"),
    stage: z.enum(AD_STAGES),
    adId,
    force: z.boolean().optional(),
    retryReview: z.boolean().optional(),
    skipGate: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal("sync-teardowns"), adIds: z.array(adId).min(1).max(200) }).strict(),
  z.object({ action: z.literal("winners"), target: z.number().int().min(10).max(500) }).strict(),
  z.object({ action: z.literal("score") }).strict(),
  z.object({ action: z.literal("mine") }).strict(),
]);

export async function POST(request: Request): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to run the Corpus Miner." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can run the Corpus Miner." }, { status: 403 });
  }

  let input: z.infer<typeof RunRequestSchema>;
  try {
    input = RunRequestSchema.parse(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  try {
    switch (input.action) {
      case "queue":
        return Response.json({ items: await stageQueue(input.stage, { limit: input.limit, force: input.force, retryReview: input.retryReview }) });
      case "step":
        return Response.json(await runAdStep(input.stage, input.adId, input));
      case "sync-teardowns":
        return Response.json({ results: await syncTeardowns(input.adIds) });
      case "winners":
        return Response.json(await runWinners(input.target));
      case "score":
        return Response.json(await runScore());
      case "mine":
        return Response.json(await runMine());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const setupRequired = /schema cache|relation .* does not exist|Could not find the table|bucket not found/i.test(message);
    return Response.json(
      { error: setupRequired ? `Database setup is incomplete (${message}). Apply migrations 017–021.` : message },
      { status: setupRequired ? 503 : 500 },
    );
  }
}
