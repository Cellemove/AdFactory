import { supabase } from "../src/lib/db";

async function main() {
  const brand = process.argv[2];
  if (!brand) throw new Error("Usage: tsx --env-file=.env scripts/miner-diagnose.ts <brand>");
  const state = await supabase.from("CorpusAdState").select("*").eq("brandName", brand);
  if (state.error) throw new Error(state.error.message);
  const rows = state.data ?? [];
  const counts = (values: Array<string | null>) => values.reduce<Record<string, number>>((out, value) => {
    const key = value ?? "pending";
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {});
  console.log(JSON.stringify({ brand, ads: rows.length, stages: counts(rows.map(row => row.stage)) }, null, 2));
  if (!rows.length) return;
  for (const table of ["AdMedia", "CorpusTranscriptRun", "CorpusExtractRun"] as const) {
    const result = await supabase.from(table).select("*").in("competitorAdId", rows.map(row => row.id)).order("createdAt", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    const latest = new Map<string, { status: string; reason: string | null }>();
    for (const row of result.data ?? []) {
      if (!latest.has(row.competitorAdId)) latest.set(row.competitorAdId, {
        status: row.status,
        reason: "errorSummary" in row ? row.errorSummary : "statusReason" in row ? row.statusReason : null,
      });
    }
    console.log(JSON.stringify({ table, statuses: counts([...latest.values()].map(row => row.status)), errors: counts([...latest.values()].filter(row => row.reason).map(row => row.reason)) }, null, 2));
    if (table !== "AdMedia") {
      const failed = result.data?.find(row => "errorSummary" in row && row.errorSummary?.includes("duplicate key"));
      if (failed) {
        const child = table === "CorpusTranscriptRun" ? "CorpusTranscriptSegment" : "AdBeat";
        const saved = await supabase.from(child).select("*").eq("runId", failed.id);
        console.log(JSON.stringify({ sample: table, runId: failed.id, savedCount: saved.data?.length, savedError: saved.error }, null, 2));
      }
    }
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
