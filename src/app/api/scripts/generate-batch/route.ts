import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { CreateScriptProjectSchema, createScriptProjectCore } from "@/lib/cellumove/create-script-project.server";
import { BATCH_CONCURRENCY, buildBatchVariants, mapWithConcurrency, type BatchVariant } from "@/lib/cellumove/script-batch";
import { HOOK_BY_SLUG, type HookMechanic } from "@/lib/cellumove/formats";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";
import type { Json, ReferenceFormatRow } from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// One brief fans out along ONE of: frameworks (2-5, compare structures) or
// hook mechanics × optional heat levels (the "many ways to say the same
// message" axis, up to 10 variants total).
const BatchInputSchema = z.object({
  input: CreateScriptProjectSchema,
  frameworkIds: z.array(z.string().min(1)).max(5).optional(),
  hookMechanics: z.array(z.string().min(1)).max(6).optional(),
  heatLevels: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).max(4).optional(),
}).refine(
  (value) => (value.frameworkIds?.length ?? 0) >= 2 || (value.hookMechanics?.length ?? 0) >= 1 || (value.heatLevels?.length ?? 0) >= 2,
  { message: "Pick a batch axis: at least two frameworks, a set of hook mechanics, or at least two heat levels." },
).refine(
  (value) => !(value.frameworkIds?.length && (value.hookMechanics?.length || value.heatLevels?.length)),
  { message: "Frameworks are their own comparison — don't combine them with hook or heat axes." },
);

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

  let variants: BatchVariant[];
  try {
    let frameworks: { id: string; name: string }[] | undefined;
    if (payload.frameworkIds?.length) {
      const ids = [...new Set(payload.frameworkIds)];
      if (ids.length < 2) return Response.json({ error: "Choose at least two different frameworks." }, { status: 400 });
      const frameworkResult = await supabase.from("ReferenceFormat").select("*").in("id", ids);
      if (frameworkResult.error) return Response.json({ error: frameworkResult.error.message }, { status: 400 });
      const rows = (frameworkResult.data ?? []) as ReferenceFormatRow[];
      if (rows.length !== ids.length) return Response.json({ error: "One or more selected frameworks are unavailable." }, { status: 400 });
      frameworks = rows.map((row) => ({ id: row.id, name: row.name }));
    }
    const mechanics = payload.hookMechanics
      ?.map((slug) => HOOK_BY_SLUG[slug as HookMechanic])
      .filter((mechanic): mechanic is NonNullable<typeof mechanic> => Boolean(mechanic));
    if (payload.hookMechanics?.length && mechanics?.length !== payload.hookMechanics.length) {
      return Response.json({ error: "One or more hook mechanics are unknown." }, { status: 400 });
    }
    variants = buildBatchVariants(payload.input, {
      frameworks,
      hookMechanics: mechanics,
      heatLevels: payload.heatLevels,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid batch axes." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let writable = true;
      const write = (message: StreamMessage) => { if (writable) try { controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`)); } catch { writable = false; } };
      const onAbort = () => { writable = false; };
      request.signal.addEventListener("abort", onAbort, { once: true });
      void (async () => {
        try {
          // Bounded parallelism: two full generations in flight keeps 10
          // variants inside maxDuration without hammering the Vertex quota.
          const results = await mapWithConcurrency(variants, BATCH_CONCURRENCY, async (variant, index) => {
            write({ type: "event", event: { stage: "setup", level: "info", message: `Draft ${index + 1}/${variants.length} · ${variant.label}`, detail: "Starting variant generation", timestamp: new Date().toISOString() } });
            try {
              const result = await createScriptProjectCore(variant.input, {
                actor,
                onProgress: (event) => write({ type: "event", event: { ...event, message: `${variant.label} · ${event.message}`, timestamp: new Date().toISOString() } }),
              });
              return { variantId: variant.key, variantLabel: variant.label, projectId: result.id, error: null as string | null };
            } catch (error) {
              return { variantId: variant.key, variantLabel: variant.label, projectId: null, error: error instanceof Error ? error.message : String(error) };
            }
          });
          const batchId = newId();
          const succeeded = results.filter((result) => result.projectId).length;
          const insert = await supabase.from("Research").insert({
            id: batchId,
            type: "script_batch",
            angleSlug: null,
            focus: payload.input.idea,
            drafts: JSON.stringify({ schemaVersion: 1, results }),
            status: succeeded === results.length ? "saved" : "partial",
            notes: `${succeeded}/${results.length} variant drafts generated`,
            queryPlan: {
              frameworkIds: payload.frameworkIds ?? null,
              hookMechanics: payload.hookMechanics ?? null,
              heatLevels: payload.heatLevels ?? null,
              productId: payload.input.productId,
            } as Json,
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
