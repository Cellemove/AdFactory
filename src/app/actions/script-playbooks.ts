"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStrategist } from "@/lib/authorization";
import type { Json, ScriptPlaybookVersionRow } from "@/lib/database.types";
import { newId, supabase } from "@/lib/db";

const DraftSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(3).max(160),
  promptInstructions: z.string().trim().min(40).max(50000),
  config: z.string().trim().min(2).max(100000),
}).strict();

function sourceHash(promptInstructions: string, config: unknown): string {
  return createHash("sha256").update(JSON.stringify({ promptInstructions, config })).digest("hex");
}

async function nextVersion(): Promise<string> {
  const result = await supabase.from("ScriptPlaybookVersion").select("version");
  if (result.error) throw new Error(result.error.message);
  const numbers = (result.data ?? []).flatMap((row) => {
    const match = String(row.version).match(/(?:^|-)v(\d+)$/i);
    return match?.[1] ? [Number(match[1])] : [];
  });
  return `creative-workflow-v${Math.max(0, ...numbers) + 1}`;
}

export async function saveScriptPlaybookDraft(input: z.infer<typeof DraftSchema>) {
  const actor = await requireStrategist();
  const parsed = DraftSchema.parse(input);
  let config: Record<string, unknown>;
  try {
    const value = JSON.parse(parsed.config) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Configuration must be a JSON object.");
    config = value as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid playbook JSON: ${error.message}` : "Invalid playbook JSON.");
  }
  const now = new Date().toISOString();
  const existingResult = parsed.id
    ? await supabase.from("ScriptPlaybookVersion").select("*").eq("id", parsed.id).maybeSingle()
    : { data: null, error: null };
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data as ScriptPlaybookVersionRow | null;
  const common = {
    title: parsed.title,
    promptInstructions: parsed.promptInstructions,
    config: config as Json,
    sourceHash: sourceHash(parsed.promptInstructions, config),
    updatedAt: now,
  };
  if (existing?.status === "draft") {
    const updated = await supabase.from("ScriptPlaybookVersion").update(common).eq("id", existing.id).select("*").single();
    if (updated.error) throw new Error(updated.error.message);
    revalidatePath("/knowledge");
    return updated.data;
  }
  const inserted = await supabase.from("ScriptPlaybookVersion").insert({
    id: newId(), version: await nextVersion(), status: "draft", ...common,
    createdByUserId: actor.id, publishedAt: null, createdAt: now,
  }).select("*").single();
  if (inserted.error) throw new Error(inserted.error.message);
  revalidatePath("/knowledge");
  return inserted.data;
}

export async function publishScriptPlaybook(id: string) {
  await requireStrategist();
  const draftResult = await supabase.from("ScriptPlaybookVersion").select("*").eq("id", z.string().min(1).parse(id)).maybeSingle();
  const draft = draftResult.data as ScriptPlaybookVersionRow | null;
  if (draftResult.error) throw new Error(draftResult.error.message);
  if (!draft || draft.status !== "draft") throw new Error("Only a draft playbook can be published.");
  const now = new Date().toISOString();
  const previousResult = await supabase.from("ScriptPlaybookVersion").select("id").eq("status", "published").maybeSingle();
  const previousId = previousResult.data?.id ?? null;
  if (previousResult.error) throw new Error(previousResult.error.message);
  if (previousId) {
    const retired = await supabase.from("ScriptPlaybookVersion").update({ status: "retired", updatedAt: now }).eq("id", previousId);
    if (retired.error) throw new Error(retired.error.message);
  }
  const published = await supabase.from("ScriptPlaybookVersion").update({ status: "published", publishedAt: now, updatedAt: now }).eq("id", draft.id).select("*").single();
  if (published.error) {
    if (previousId) await supabase.from("ScriptPlaybookVersion").update({ status: "published", updatedAt: new Date().toISOString() }).eq("id", previousId);
    throw new Error(published.error.message);
  }
  revalidatePath("/knowledge");
  revalidatePath("/scripts/new");
  return published.data;
}

export async function retireScriptPlaybookDraft(id: string) {
  await requireStrategist();
  const result = await supabase.from("ScriptPlaybookVersion").update({ status: "retired", updatedAt: new Date().toISOString() }).eq("id", z.string().min(1).parse(id)).eq("status", "draft");
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/knowledge");
}
