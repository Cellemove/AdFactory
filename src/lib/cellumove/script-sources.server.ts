import "server-only";

import type { GeneratedScriptSource } from "@/lib/cellumove/script-generation.server";
import type { Json } from "@/lib/database.types";
import { newId, supabase, unwrap } from "@/lib/db";

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function persistScriptSources(
  projectId: string,
  sources: GeneratedScriptSource[],
  createdAt: string,
): Promise<void> {
  if (!sources.length) return;
  const existing = unwrap(
    await supabase.from("ScriptSource").select("sourceType, sourceId, title").eq("projectId", projectId),
  ) as Array<{ sourceType: string; sourceId: string | null; title: string }>;
  const existingKeys = new Set(existing.map((source) => `${source.sourceType}:${source.sourceId ?? ""}:${source.title}`));
  const pending = sources.filter((source) => !existingKeys.has(`${source.sourceType}:${source.sourceId ?? ""}:${source.title}`));
  if (!pending.length) return;
  unwrap(await supabase.from("ScriptSource").insert(pending.map((source) => ({
    id: newId(),
    projectId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    title: source.title,
    url: source.url,
    snapshot: asJson(source.snapshot),
    createdAt,
  }))).select("id"));
}
