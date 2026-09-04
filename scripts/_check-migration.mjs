import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } = await supabase
  .from("ReferenceFormat")
  .select("id, name, sourceKind, sourceUrl, sourceLabel")
  .limit(3);

if (error) {
  console.error("QUERY FAILED:", error.message);
  process.exit(1);
}
console.log("Migration columns are queryable. Sample rows:");
console.log(JSON.stringify(data, null, 2));
