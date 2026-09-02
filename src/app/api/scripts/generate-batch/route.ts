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
  frameworkIds: z.array(z.string().min(1)).min(2).max(5),
});

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
  payload.frameworkIds = [...new Set(payload.frameworkIds)];
  if (payload.frameworkIds.length < 2) return Response.json({ error: "Choose at least two different frameworks." }, { status: 400 });

  const frameworkResult = await supabase.from("ReferenceFormat").select("*").in("id", payload.frameworkIds);
  if (frameworkResult.error) return Response.json({ error: frameworkResult.error.message }, { status: 400 });
  const frameworks = (frameworkResult.data ?? []) as ReferenceFormatRow[];
  if (frameworks.length !== payload.frameworkIds.length) return Response.json({ error: "One or more selected frameworks are unavailable." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let writable = true;
      const write = (message: StreamMessage) => { if (writable) try { controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`)); } catch { writable = false; } };
      const onAbort = () => { writable = false; };
      request.signal.addEventListener("abort", onAbort, { once: true });
      void (async () => {
        try {
          const results: Array<{ frameworkId: string; frameworkName: string; projectId: string | null; error: string | null }> = [];
          for (let index = 0; index < frameworks.length; index += 1) {
            const framework = frameworks[index]!;
            write({ type: "event", event: { stage: "setup", level: "info", message: `Draft ${index + 1}/${frameworks.length} · ${framework.name}`, detail: "Starting framework-specific generation", timestamp: new Date().toISOString() } });
            try {
              const result = await createScriptProjectCore({ ...payload.input, referenceFormatId: framework.id }, {
                actor,
                onProgress: (event) => write({ type: "event", event: { ...event, message: `${framework.name} · ${event.message}`, timestamp: new Date().toISOString() } }),
              });
              results.push({ frameworkId: framework.id, frameworkName: framework.name, projectId: result.id, error: null });
            } catch (error) {
              results.push({ frameworkId: framework.id, frameworkName: framework.name, projectId: null, error: error instanceof Error ? error.message : String(error) });
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
            notes: `${succeeded}/${results.length} framework drafts generated`,
            queryPlan: { frameworkIds: payload.frameworkIds, productId: payload.input.productId } as Json,
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

