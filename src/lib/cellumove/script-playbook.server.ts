import "server-only";

import { z } from "zod";
import type { ScriptPlaybookVersionRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { ScriptWorkflowPlaybookSnapshotSchema, type ScriptWorkflowPlaybookSnapshot } from "@/lib/cellumove/script-creative-workflow";

const PlaybookConfigSchema = z.record(z.unknown());

export function playbookSnapshot(row: ScriptPlaybookVersionRow): ScriptWorkflowPlaybookSnapshot {
  return ScriptWorkflowPlaybookSnapshotSchema.parse({
    id: row.id,
    version: row.version,
    title: row.title,
    sourceHash: row.sourceHash,
    promptInstructions: row.promptInstructions,
    config: PlaybookConfigSchema.parse(row.config),
  });
}

export async function loadPublishedScriptPlaybook(id?: string | null): Promise<ScriptPlaybookVersionRow> {
  let query = supabase.from("ScriptPlaybookVersion").select("*");
  query = id ? query.eq("id", id) : query.eq("status", "published").order("publishedAt", { ascending: false }).limit(1);
  const response = await query.maybeSingle();
  if (response.error) {
    throw new Error(`Creative workflow is not installed. Apply migrations/022_script_creative_workflow.sql. ${response.error.message}`);
  }
  const row = response.data as ScriptPlaybookVersionRow | null;
  if (!row || row.status !== "published") throw new Error("No published Creative Strategist playbook is available.");
  playbookSnapshot(row);
  return row;
}

export async function loadScriptPlaybookVersion(id: string): Promise<ScriptPlaybookVersionRow> {
  const response = await supabase.from("ScriptPlaybookVersion").select("*").eq("id", id).maybeSingle();
  if (response.error) {
    throw new Error(`Creative workflow is not installed. Apply migrations/022_script_creative_workflow.sql. ${response.error.message}`);
  }
  const row = response.data as ScriptPlaybookVersionRow | null;
  if (!row) throw new Error("The script's snapshotted playbook version is unavailable.");
  playbookSnapshot(row);
  return row;
}
