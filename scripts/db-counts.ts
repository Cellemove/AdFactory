import { supabase } from "../src/lib/db";

async function main() {
  const tables = ["Angle", "SubAvatar", "AvatarResearch", "WinningAd", "BigSwing", "CopyPrinciple", "Settings", "Brief", "Run", "Generation", "Product"] as const;
  const counts: Record<string, number | string> = {};
  for (const t of tables) {
    const res = await supabase.from(t).select("*", { count: "exact", head: true });
    counts[t] = res.error ? `error: ${res.error.message}` : (res.count ?? 0);
  }
  console.log(counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
