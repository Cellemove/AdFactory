import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { CreateScriptProjectSchema, createScriptProjectCore } from "@/lib/cellumove/create-script-project.server";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";
import type { Json, ReferenceFormatRow } from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const BatchInputSchema = z.object({
  input: CreateScriptProjectSchema,
  frameworkIds: z.array(z.string().min(1)).min(2).max(5).optional(),
  heatLevels: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).min(2).max(4).optional(),
}).refine((value) => Boolean(value.frameworkIds) !== Boolean(value.heatLevels), "Choose either framework comparison or Heat comparison.");

type StreamMessage =
  | { type: "event"; event: ScriptGenerationProgressEvent }
  | { type: "complete"; batchId: string }
  | { type: "error"; message: string };

export async function POST(request: Request): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to generate scripts." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can generate script batches." }, { status: 403 });
  let payload: z.infer<typeof BatchInputSchema>;
  try { payload = BatchInputSchema.parse(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid batch request." }, { status: 400 }); }
  if (payload.frameworkIds) payload.frameworkIds = [...new Set(payload.frameworkIds)];
  if (payload.heatLevels) payload.heatLevels = [...new Set(payload.heatLevels)];
  if (payload.frameworkIds && payload.frameworkIds.length < 2) return Response.json({ error: "Choose at least two different frameworks." }, { status: 400 });
  if (payload.heatLevels && payload.heatLevels.length < 2) return Response.json({ error: "Choose at least two different Heat levels." }, { status: 400 });

  const frameworkResult = payload.frameworkIds
    ? await supabase.from("ReferenceFormat").select("*").in("id", payload.frameworkIds)
    : { data: [] as ReferenceFormatRow[], error: null };
  if (frameworkResult.error) return Response.json({ error: frameworkResult.error.message }, { status: 400 });
  const frameworks = (frameworkResult.data ?? []) as ReferenceFormatRow[];
  if (payload.frameworkIds && frameworks.length !== payload.frameworkIds.length) return Response.json({ error: "One or more selected frameworks are unavailable." }, { status: 400 });
  const variants = payload.frameworkIds
    ? frameworks.map((framework) => ({ key: framework.id, label: framework.name, input: { ...payload.input, referenceFormatId: framework.id } }))
    : payload.heatLevels!.map((heatLevel) => ({ key: `heat-${heatLevel}`, label: `Heat ${heatLevel}`, input: { ...payload.input, heatLevel, title: `${payload.input.title} · Heat ${heatLevel}`, conceptLabel: `${payload.input.conceptLabel} · Heat ${heatLevel}` } }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let writable = true;
      const write = (message: StreamMessage) => { if (writable) try { controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`)); } catch { writable = false; } };
      const onAbort = () => { writable = false; };
      request.signal.addEventListener("abort", onAbort, { once: true });
      void (async () => {
        try {
          const results: Array<{ variantId: string; variantName: string; projectId: string | null; error: string | null }> = [];
          for (let index = 0; index < variants.length; index += 1) {
            const variant = variants[index]!;
            write({ type: "event", event: { stage: "setup", level: "info", message: `Draft ${index + 1}/${variants.length} · ${variant.label}`, detail: "Starting comparison generation", timestamp: new Date().toISOString() } });
            try {
              const result = await createScriptProjectCore(variant.input, {
                actor,
                onProgress: (event) => write({ type: "event", event: { ...event, message: `${variant.label} · ${event.message}`, timestamp: new Date().toISOString() } }),
              });
              results.push({ variantId: variant.key, variantName: variant.label, projectId: result.id, error: null });
            } catch (error) {
              results.push({ variantId: variant.key, variantName: variant.label, projectId: null, error: error instanceof Error ? error.message : String(error) });
            }
          }
          const batchId = newId();
          const succeeded = results.filter((result) => result.projectId).length;
          const insert = await supabase.from("Research").insert({
            id: batchId,
            type: "script_batch",
            angleSlug: null,
            focus: payload.input.idea,
            drafts: JSON.stringify({ schemaVersion: 1, results }),
            status: succeeded === results.length ? "saved" : "partial",
            notes: `${succeeded}/${results.length} comparison drafts generated`,
            queryPlan: { frameworkIds: payload.frameworkIds ?? null, heatLevels: payload.heatLevels ?? null, productId: payload.input.productId } as Json,
            createdAt: new Date().toISOString(),
          });
          if (insert.error) throw new Error(insert.error.message);
          write({ type: "complete", batchId });
        } catch (error) {
          write({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          request.signal.removeEventListener("abort", onAbort);
          if (writable) controller.close();
        }
      })();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
