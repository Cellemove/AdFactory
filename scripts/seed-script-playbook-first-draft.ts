import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import cuid from "cuid";
import { SCRIPT_STUDIO_PLAYBOOK_FIRST_DRAFT as draft } from "../src/lib/cellumove/script-playbook-first-draft";

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

const url = requireValue(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim(),
  "Supabase URL is required.",
);
const serviceKey = requireValue(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(), "Supabase service-role key is required.");

async function main() {
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sourceHash = createHash("sha256")
    .update(JSON.stringify({ promptInstructions: draft.promptInstructions, config: draft.config }))
    .digest("hex");

  const existing = await supabase
    .from("ScriptPlaybookVersion")
    .select("id,version,status")
    .eq("version", draft.version)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data) {
    console.log(`Kept existing ${existing.data.version} (${existing.data.status}); no fields were overwritten.`);
    return;
  }

  const now = new Date().toISOString();
  const inserted = await supabase.from("ScriptPlaybookVersion").insert({
    id: cuid(),
    version: draft.version,
    title: draft.title,
    status: "draft",
    promptInstructions: draft.promptInstructions,
    config: draft.config,
    sourceHash,
    createdByUserId: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  }).select("id,version,status,title").single();
  if (inserted.error) throw new Error(inserted.error.message);
  console.log(`Created ${inserted.data.version} as an editable ${inserted.data.status}: ${inserted.data.title}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
