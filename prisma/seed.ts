// Idempotent seed: angles + formats + principles + default settings.
// Run: `npm run db:seed`

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ANGLES } from "../src/lib/cellumove/angles";
import { BIG_SWING_FORMATS } from "../src/lib/cellumove/formats";
import { COPY_PRINCIPLES } from "../src/lib/cellumove/copy-principles";

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
const newId = () => randomUUID();

async function ensureRow(table: string, matchColumn: string, matchValue: string, fields: Record<string, unknown>) {
  const existing = await supabase.from(table).select("id").eq(matchColumn, matchValue).maybeSingle();
  if (existing.error) throw new Error(`${table} lookup: ${existing.error.message}`);
  if (existing.data) {
    const upd = await supabase.from(table).update(fields).eq("id", (existing.data as { id: string }).id);
    if (upd.error) throw new Error(`${table} update: ${upd.error.message}`);
  } else {
    const ins = await supabase.from(table).insert({ id: newId(), [matchColumn]: matchValue, ...fields });
    if (ins.error) throw new Error(`${table} insert: ${ins.error.message}`);
  }
}

async function seedAngles() {
  for (const a of ANGLES) {
    await ensureRow("Angle", "slug", a.slug, {
      name: a.name,
      requiredKeyword: a.requiredKeyword,
      mechanism: a.mechanism,
      bannedMechanism: a.bannedMechanism,
      silhouette: a.silhouette,
      colorway: a.colorway,
      order: a.order,
      createdAt: now(),
    });
  }
  console.log(`✓ angles: ${ANGLES.length}`);
}

async function seedBigSwings() {
  for (let i = 0; i < BIG_SWING_FORMATS.length; i++) {
    const f = BIG_SWING_FORMATS[i]!;
    await ensureRow("BigSwing", "slug", f.slug, {
      name: f.name,
      format: f.slug,
      hookMechanic: null,
      funnel: f.funnelFit[0] ?? "TOFU",
      description: f.description,
      headlineOptions: JSON.stringify(f.defaultHookOptions),
      visualSpec: f.visualSpec,
      order: i + 1,
      createdAt: now(),
    });
  }
  console.log(`✓ big-swings: ${BIG_SWING_FORMATS.length}`);
}

async function seedPrinciples() {
  for (const p of COPY_PRINCIPLES) {
    await ensureRow("CopyPrinciple", "slug", p.slug, {
      category: p.category,
      title: p.title,
      body: p.body,
      order: p.order,
    });
  }
  console.log(`✓ copy principles: ${COPY_PRINCIPLES.length}`);
}

async function seedSettings() {
  const existing = await supabase.from("Settings").select("id").eq("id", "default").maybeSingle();
  if (existing.error) throw new Error(`Settings lookup: ${existing.error.message}`);
  if (!existing.data) {
    const ins = await supabase.from("Settings").insert({ id: "default", updatedAt: now(), createdAt: now() });
    if (ins.error) throw new Error(`Settings insert: ${ins.error.message}`);
  }
  console.log("✓ settings: default row ensured");
}

async function main() {
  await seedAngles();
  await seedBigSwings();
  await seedPrinciples();
  await seedSettings();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
