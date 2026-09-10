import { createGoogleSheetImportRun, executeGoogleSheetEvidenceImport } from "../src/lib/cellumove/evidence-import.server";
import { supabase } from "../src/lib/db";

async function main() {
  const strategist = await supabase.from("AppUser").select("id").eq("role", "creative_strategist").limit(1).maybeSingle();
  if (strategist.error) throw new Error(strategist.error.message);
  if (!strategist.data) throw new Error("No creative strategist exists to own the import run.");
  const run = await createGoogleSheetImportRun(strategist.data.id);
  console.log(`Started evidence import ${run.id}`);
  await executeGoogleSheetEvidenceImport(run.id);
  const completed = await supabase.from("EvidenceImportRun").select("status, counts, warnings, errors").eq("id", run.id).single();
  if (completed.error || !completed.data) throw new Error(completed.error?.message ?? "Import run disappeared.");
  console.log(JSON.stringify(completed.data, null, 2));
  if (completed.data.status !== "complete") process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
