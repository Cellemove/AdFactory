// LLM smoke test — exercises the three Gemini call paths the app uses, headless,
// via the app's own libs (runAgent + context builders + claim scan):
//   1. closed-book text  (copywriter ask on a real researched avatar)
//   2. closed-book JSON  (what every G3→G7 pipeline stage uses)
//   3. grounded (tools)  (what G2 deep-dive passes use)
// Run: npx tsx --env-file=.env scripts/smoke-llm.ts

import { supabase } from "../src/lib/db";
import { runAgent, extractJsonObject } from "../src/lib/cellumove/agents";
import { loadAvatarContext, researchBlock } from "../src/lib/cellumove/context";
import { renderCopywriterProfile } from "../src/lib/cellumove/avatar-profile";
import { BRAND_BASE, CLAIMS_GUARDRAIL } from "../src/lib/cellumove/pipeline-stages";
import { scanClaims } from "../src/lib/cellumove/claim-check";

async function pickReadyAvatar(): Promise<string | null> {
  const res = await supabase.from("AvatarResearch").select("subAvatarId").limit(20);
  for (const row of (res.data ?? []) as { subAvatarId: string }[]) {
    try {
      await loadAvatarContext(row.subAvatarId);
      return row.subAvatarId;
    } catch {
      /* not ready — try the next */
    }
  }
  return null;
}

async function main() {
  // ── 1. Copywriter ask (closed-book text, gemini-2.5-pro, SOPs attached) ─────
  const subId = await pickReadyAvatar();
  if (!subId) {
    console.log("SMOKE_FAIL no research-complete avatar found — run G1 research first");
    process.exit(1);
  }
  const ctx = await loadAvatarContext(subId);
  console.log(`avatar: ${ctx.sub.name} (angle: ${ctx.angle.name})`);

  const t0 = Date.now();
  const reply = await runAgent({
    role: "copywriter",
    instruction: [
      "You are the CelluMove COPYWRITER in a live working session with a creative strategist.",
      BRAND_BASE,
      "Deliver exactly what is asked, in clean markdown, no preamble. Sound like the avatar — use her register and phrases.",
      CLAIMS_GUARDRAIL,
    ].join("\n"),
    context: [researchBlock(ctx), renderCopywriterProfile(ctx.profile), "STRATEGIST:\n10 scroll-stopping hooks for this angle, her words only."]
      .filter(Boolean)
      .join("\n\n"),
    feature: "smoke_test",
    metadata: { path: "copywriter_text" },
    maxOutputTokens: 4096,
  });
  const claims = scanClaims(reply);
  console.log(`\n[1] copywriter text call OK (${Math.round((Date.now() - t0) / 1000)}s, claims: ${claims.status}${claims.flags.length ? ` — ${claims.flags.map((f) => f.phrase).join(", ")}` : ""})`);
  console.log("--- first 600 chars ---");
  console.log(reply.slice(0, 600));
  console.log("---");

  // ── 2. JSON mode (the G3→G7 path) ───────────────────────────────────────────
  const t1 = Date.now();
  const jsonText = await runAgent({
    role: "strategist",
    instruction: 'Return ONLY JSON: {"hooks": string[]} with EXACTLY 3 hooks for the avatar described.',
    context: researchBlock(ctx),
    json: true,
    feature: "smoke_test",
    metadata: { path: "json_mode" },
    maxOutputTokens: 2048,
  });
  const parsed = extractJsonObject<{ hooks?: string[] }>(jsonText);
  const jsonOk = Array.isArray(parsed.hooks) && parsed.hooks.length === 3;
  console.log(`\n[2] JSON-mode call ${jsonOk ? "OK" : "SHAPE MISMATCH"} (${Math.round((Date.now() - t1) / 1000)}s) — hooks: ${parsed.hooks?.length ?? 0}`);

  // ── 3. Grounded (tools) — the G2 deep-dive path ─────────────────────────────
  const t2 = Date.now();
  const grounded = await runAgent({
    role: "researcher",
    instruction: "Use Google Search, then answer in ONE short sentence.",
    context: "What subreddit do people use to discuss compression leggings? Name one real subreddit.",
    grounded: true,
    feature: "smoke_test",
    metadata: { path: "grounded" },
    maxOutputTokens: 1024,
  });
  console.log(`\n[3] grounded call OK (${Math.round((Date.now() - t2) / 1000)}s) — ${grounded.trim().slice(0, 120)}`);

  console.log("\nSMOKE_PASS all three call paths work");
}

main().catch((e) => {
  console.log("SMOKE_FAIL", String(e instanceof Error ? e.message : e).slice(0, 400));
  process.exit(1);
});
