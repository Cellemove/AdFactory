import "server-only";

import { supabase } from "../src/lib/db";
import { getJsonStringArray, GOOGLE_SHEET_TABS } from "../src/lib/cellumove/evidence-library";

async function main() {
  const [evidenceResult, revisionResult, jobResult] = await Promise.all([
    supabase.from("ScriptEvidence").select("id, sheetName, evidenceLevel, overrideFields, conflictFields").range(0, 999),
    supabase.from("ScriptEvidenceRevision").select("id").range(0, 999),
    supabase.from("EvidenceEnrichmentJob").select("id").range(0, 999),
  ]);
  for (const [table, result] of [
    ["ScriptEvidence", evidenceResult],
    ["ScriptEvidenceRevision", revisionResult],
    ["EvidenceEnrichmentJob", jobResult],
  ] as const) {
    if (result.error) {
      throw new Error(`${table}: ${result.error.message || JSON.stringify(result.error)}`);
    }
  }

  const evidence = evidenceResult.data ?? [];
  const tabs = Object.fromEntries(
    GOOGLE_SHEET_TABS.map((sheetName) => [
      sheetName,
      evidence.filter((row) => row.sheetName === sheetName).length,
    ]),
  );

  console.log(
    JSON.stringify(
      {
        evidence: evidence.length,
        revisions: revisionResult.data?.length ?? 0,
        enrichmentJobs: jobResult.data?.length ?? 0,
        observed: evidence.filter((row) => row.evidenceLevel === "observed").length,
        edited: evidence.filter((row) => getJsonStringArray(row.overrideFields).length > 0).length,
        conflicts: evidence.filter((row) => getJsonStringArray(row.conflictFields).length > 0).length,
        tabs,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
