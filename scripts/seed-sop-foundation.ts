// Idempotent seed for the Layer-1 SOP foundation: 5 reference formats + 11
// market-profile stubs + the deep-dive-template SOP. Most SOPs are written by the
// user in /knowledge; the deep-dive template is the one system-authored Sop row we
// seed, because research.ts loads it by type as the avatar-research quality bar.
//
// Run: `npm run seed:sop`  (requires the 001_sop_foundation.sql migration first)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { REFERENCE_FORMATS } from "../src/lib/cellumove/reference-formats";
import { MARKET_PROFILES } from "../src/lib/cellumove/market-profiles";
import { DEEP_DIVE_TEMPLATE, DEEP_DIVE_TEMPLATE_TITLE } from "../src/lib/cellumove/deep-dive-template";
import { SCRIPT_ENGINE_SOP_BODY, SCRIPT_ENGINE_SOP_VERSION, SCRIPT_ENGINE_PHRASEBANK } from "../src/lib/cellumove/script-engine-sop";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = () => new Date().toISOString();

async function ensureRow(table: string, matchColumn: string, matchValue: string, fields: Record<string, unknown>) {
  const existing = await supabase.from(table).select("id").eq(matchColumn, matchValue).maybeSingle();
  if (existing.error) throw new Error(`${table} lookup: ${existing.error.message}`);
  if (existing.data) {
    const upd = await supabase.from(table).update(fields).eq("id", (existing.data as { id: string }).id);
    if (upd.error) throw new Error(`${table} update: ${upd.error.message}`);
  } else {
    const ins = await supabase.from(table).insert({ id: randomUUID(), [matchColumn]: matchValue, ...fields });
    if (ins.error) throw new Error(`${table} insert: ${ins.error.message}`);
  }
}

async function seedReferenceFormats() {
  for (const f of REFERENCE_FORMATS) {
    await ensureRow("ReferenceFormat", "slug", f.slug, {
      name: f.name,
      description: f.description,
      beats: JSON.stringify(f.beats),
      bestForAngle: f.bestForAngle,
      optimalDurationSec: f.optimalDurationSec,
      exampleScripts: JSON.stringify(f.exampleScripts),
      order: f.order,
      updatedAt: now(),
    });
  }
  console.log(`✓ reference formats: ${REFERENCE_FORMATS.length}`);
}

async function seedMarketProfiles() {
  for (const m of MARKET_PROFILES) {
    await ensureRow("MarketProfile", "code", m.code, {
      name: m.name,
      tone: m.tone,
      vocabulary: JSON.stringify(m.vocabulary),
      hooksThatWork: JSON.stringify(m.hooksThatWork),
      hooksThatFlop: JSON.stringify(m.hooksThatFlop),
      allowedClaims: JSON.stringify(m.allowedClaims),
      forbiddenClaims: JSON.stringify(m.forbiddenClaims),
      disclaimerClaims: JSON.stringify(m.disclaimerClaims),
      trustpilotScore: m.trustpilotScore,
      culturalNotes: m.culturalNotes,
      order: m.order,
      updatedAt: now(),
    });
  }
  console.log(`✓ market profiles: ${MARKET_PROFILES.length}`);
}

// The deep-dive template SOP is the one Sop row we seed: it's a system-authored
// quality bar (not user prose), and research.ts loads it by type. Keyed on slug so
// re-running refreshes the body in place; createdAt is set on insert only so updates
// don't reset it.
// Keyed on slug so re-running refreshes the body in place; createdAt is set on
// insert only so updates don't reset it.
async function ensureSop(slug: string, fields: Record<string, unknown>) {
  const existing = await supabase.from("Sop").select("id").eq("slug", slug).maybeSingle();
  if (existing.error) throw new Error(`Sop lookup: ${existing.error.message}`);
  if (existing.data) {
    const upd = await supabase.from("Sop").update({ ...fields, updatedAt: now() }).eq("id", (existing.data as { id: string }).id);
    if (upd.error) throw new Error(`Sop update: ${upd.error.message}`);
  } else {
    const ins = await supabase.from("Sop").insert({ id: randomUUID(), slug, createdAt: now(), updatedAt: now(), ...fields });
    if (ins.error) throw new Error(`Sop insert: ${ins.error.message}`);
  }
}

// The deep-dive template SOP is a system-authored quality bar (not user prose);
// research.ts loads it by type.
async function seedDeepDiveTemplate() {
  await ensureSop("deep-dive-template", {
    type: "deep_dive_template",
    title: DEEP_DIVE_TEMPLATE_TITLE,
    body: DEEP_DIVE_TEMPLATE,
    payload: null,
    roleScope: "researcher",
    marketScope: null,
    pinned: true,
    order: 0,
  });
  console.log("✓ deep-dive template SOP");
}

// The boss's Script Engine v1.8 — replaces the built-in generation system
// prompt via the role_prompt override (migration 013 row, same slug). The
// phrase bank rides along as a copywriter-scoped calibration payload so
// More-hooks and module-assist inherit it too.
async function seedScriptEngine() {
  await ensureSop("creative-strategist-script-maker", {
    type: "role_prompt",
    title: `CelluMove Script Engine (${SCRIPT_ENGINE_SOP_VERSION})`,
    body: SCRIPT_ENGINE_SOP_BODY,
    payload: null,
    roleScope: "strategist",
    marketScope: null,
    pinned: true,
    order: -100,
  });
  await ensureSop("script-engine-phrasebank", {
    type: "other",
    title: "Engine phrase bank & tempo tables (calibration, never copy)",
    body: [
      "Winning-register calibration from the 35-ad reverse-engineered library. Use these to judge and shape lines — accusation hooks, reframes, absolutions, enemy kills, mechanism lines, loops, skepticism, concessions, payoffs, guarantees, CTAs — plus the tempo tables (words/second, word budgets, beat durations, runtime split).",
      "These are NEVER copy sources: the recognition test applies. If a written line could be traced to one of these, rewrite it in the avatar's words.",
    ].join("\n"),
    payload: JSON.stringify(SCRIPT_ENGINE_PHRASEBANK),
    roleScope: "copywriter",
    marketScope: null,
    pinned: false,
    order: 10,
  });
  console.log(`✓ script engine SOP (${SCRIPT_ENGINE_SOP_VERSION}) + phrase bank`);
}

async function main() {
  await seedReferenceFormats();
  await seedMarketProfiles();
  await seedDeepDiveTemplate();
  await seedScriptEngine();
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
