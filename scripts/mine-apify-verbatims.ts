// Bulk Apify verbatim mining across angles. Resumable for free: the
// VerbatimScrapeTarget ledger makes a re-run skip every post/video already paid
// for, and the cumulative --max-usd budget is enforced on ACTUAL actor spend.
//
// Run: npm run verbatims:mine-apify -- --platform=reddit,tiktok --angle=heavy-legs --max-usd=5
//      npm run verbatims:mine-apify -- --platform=meta --angle=all --dry-run
// Flags:
//   --platform=csv   reddit|meta|tiktok (default reddit)
//   --angle=slug|all (default all)
//   --max-usd=N      cumulative cap for this invocation (default 5)
//   --max-posts=N    per platform-run (default 8)
//   --max-comments=N per post (default 40)
//   --focus=phrase   optional exact Reddit search phrase for this run
//   --force          ignore the scrape ledger
//   --enough=N       per angle: stop adding platforms once N new verbatims are in (default 30)
//   --dry-run        resolve targets and print the plan, scrape nothing

import { supabase } from "../src/lib/db";
import { isApifyConfigured } from "../src/lib/apify.server";
import { INGEST_PLATFORMS, type IngestPlatform } from "../src/lib/apify";
import { ingestPlatformVerbatims } from "../src/lib/cellumove/verbatim-ingest.server";

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (!isApifyConfigured()) {
    console.error("APIFY_TOKEN is not set in .env — create a token at console.apify.com first.");
    process.exit(1);
  }
  const platforms = (flag("platform") ?? "reddit")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is IngestPlatform => (INGEST_PLATFORMS as string[]).includes(p));
  if (!platforms.length) throw new Error("--platform must name reddit, meta and/or tiktok.");
  const angleArg = flag("angle") ?? "all";
  const maxUsd = Number(flag("max-usd") ?? 5);
  const maxPosts = Number(flag("max-posts") ?? 8);
  const maxComments = Number(flag("max-comments") ?? 40);
  const force = has("force");
  const dryRun = has("dry-run");
  const market = flag("market"); // e.g. PT — tags inserted rows for market-scoped retrieval
  const focus = flag("focus");

  const anglesRes = await supabase.from("Angle").select("slug,name,mechanism").order("order");
  if (anglesRes.error) throw new Error(anglesRes.error.message);
  const angles = ((anglesRes.data ?? []) as { slug: string; name: string; mechanism: string }[])
    .filter((a) => angleArg === "all" || a.slug === angleArg);
  if (!angles.length) throw new Error(`No angle matches "${angleArg}".`);

  console.log(`${angles.length} angle(s) × [${platforms.join(", ")}] · budget $${maxUsd} · ${maxPosts} posts × ${maxComments} comments${force ? " · FORCE" : ""}${dryRun ? " · DRY RUN" : ""}\n`);
  if (dryRun) {
    for (const a of angles) for (const p of platforms) console.log(`would mine ${p.padEnd(6)} · ${a.name}`);
    return;
  }

  let spent = 0;
  let inserted = 0;
  const enough = Number(flag("enough")) || 30;
  for (const angle of angles) {
    let angleInserted = 0;
    for (const platform of platforms) {
      // An actor run cannot be stopped midway, so "enough" is checked between runs.
      if (angleInserted >= enough) {
        console.log(`· ${platform.padEnd(6)} ${angle.slug.padEnd(28)} skipped — ${angleInserted} new verbatims already meets --enough=${enough}`);
        continue;
      }
      const remaining = maxUsd - spent;
      if (remaining <= 0.05) {
        console.log(`\nBudget $${maxUsd} exhausted — stopping.`);
        console.log(`TOTAL: ${inserted} verbatims inserted · ~$${spent.toFixed(2)} spent.`);
        return;
      }
      try {
        const s = await ingestPlatformVerbatims({
          platform,
          angleSlug: angle.slug,
          subAvatarId: null,
          angleName: angle.name,
          mechanism: angle.mechanism,
          focus,
          market,
          maxPosts,
          maxCommentsPerPost: maxComments,
          maxUsd: remaining,
          force,
        });
        spent += s.estUsd;
        inserted += s.inserted;
        angleInserted += s.inserted;
        console.log(
          `✓ ${platform.padEnd(6)} ${angle.slug.padEnd(28)} scraped ${String(s.scraped).padStart(4)} → gate -${s.killedGate} · dupes -${s.killedDedupe} · AI -${s.killedLLM} → inserted ${s.inserted} · $${s.estUsd.toFixed(3)}${s.warnings.length ? ` · ${s.warnings.join(" ")}` : ""}`,
        );
      } catch (e) {
        console.error(`✗ ${platform.padEnd(6)} ${angle.slug}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.log(`\nDone — ${inserted} verbatims inserted · ~$${spent.toFixed(2)} actual Apify spend.`);
  console.log("Reminder: run `npm run scorer:embed-verbatims` so the scorer can use the new rows.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
