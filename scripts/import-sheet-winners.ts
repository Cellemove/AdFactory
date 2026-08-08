// One-off seed: fetch the winning-ads Google Sheet, filter to winners
// (ROAS >= 1.8 AND spend >= 30), and store them for the /winners page.
// Run: npx tsx --env-file=.env scripts/import-sheet-winners.ts
//
// The in-app "Refresh from sheet" button does the same thing via the server
// action; this just seeds it now without needing the app running.

import { supabase, newId } from "../src/lib/db";
import { fetchSheetCsv, buildSheetWinnersDoc } from "../src/lib/cellumove/sheet-winners";

const RESEARCH_TYPE = "sheet_winners";

async function main() {
  console.log("Fetching Google Sheet…");
  const csv = await fetchSheetCsv();
  const doc = buildSheetWinnersDoc(csv);

  console.log(`Parsed ${doc.total} winning ads (ROAS >= ${doc.criteria.minRoas} & spend >= ${doc.criteria.minSpend}).`);
  for (const m of doc.byMarket) console.log(`  ${m.market.padEnd(6)} ${m.count}`);

  const del = await supabase.from("Research").delete().eq("type", RESEARCH_TYPE);
  if (del.error) throw new Error(del.error.message);
  const ins = await supabase.from("Research").insert({
    id: newId(),
    type: RESEARCH_TYPE,
    angleSlug: null,
    focus: null,
    drafts: JSON.stringify(doc),
    status: "imported",
    createdAt: new Date().toISOString(),
  });
  if (ins.error) throw new Error(ins.error.message);

  console.log(`\nStored ${doc.total} winners → /winners (Imported section).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
