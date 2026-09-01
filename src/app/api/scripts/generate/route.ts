import { getSessionUser } from "@/lib/auth";
import {
  createScriptProjectCore,
  type CreateScriptProjectInput,
} from "@/lib/cellumove/create-script-project.server";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type StreamMessage =
  | { type: "event"; event: ScriptGenerationProgressEvent }
  | { type: "complete"; projectId: string }
  | { type: "error"; message: string };

export async function POST(request: Request): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to generate a script." }, { status: 401 });
  if (actor.role !== "creative_strategist") {
    return Response.json({ error: "Only creative strategists can generate Script Studio projects." }, { status: 403 });
  }

  let input: CreateScriptProjectInput;
  try {
    input = await request.json() as CreateScriptProjectInput;
  } catch {
    return Response.json({ error: "The generation request was not valid JSON." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let writable = true;
      const write = (message: StreamMessage) => {
        if (!writable) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          writable = false;
        }
      };
      const onAbort = () => { writable = false; };
      request.signal.addEventListener("abort", onAbort, { once: true });

      void (async () => {
        try {
          const result = await createScriptProjectCore(input, {
            actor,
            onProgress: (event) => write({
              type: "event",
              event: { ...event, timestamp: new Date().toISOString() },
            }),
          });
          write({ type: "complete", projectId: result.id });
        } catch (error) {
          write({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          request.signal.removeEventListener("abort", onAbort);
          if (writable) controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
