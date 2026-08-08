"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { extractJsonObject } from "@/lib/cellumove/agents";

// ─── SOPs ────────────────────────────────────────────────────────────────────

const SopSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional().nullable(),
  payload: z.string().optional().nullable(),
  roleScope: z.string().min(1),
  marketScope: z.string().optional().nullable(),
  pinned: z.boolean().optional(),
  order: z.number().optional(),
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function upsertSop(input: z.infer<typeof SopSchema>) {
  const parsed = SopSchema.parse(input);
  const now = new Date().toISOString();
  if (parsed.id) {
    const saved = unwrap(
      await supabase
        .from("Sop")
        .update({
          type: parsed.type,
          title: parsed.title,
          body: parsed.body ?? "",
          payload: parsed.payload ?? null,
          roleScope: parsed.roleScope,
          marketScope: parsed.marketScope ?? null,
          pinned: parsed.pinned ?? false,
          order: parsed.order ?? 0,
          updatedAt: now,
        })
        .eq("id", parsed.id)
        .select("*")
        .single(),
    );
    revalidatePath("/knowledge");
    return saved;
  }
  // New row: derive a unique slug.
  const base = parsed.slug ? slugify(parsed.slug) : slugify(parsed.title);
  let slug = base || `sop-${Date.now()}`;
  let n = 2;
  while ((await supabase.from("Sop").select("id").eq("slug", slug).maybeSingle()).data) {
    slug = `${base}-${n++}`;
  }
  const saved = unwrap(
    await supabase
      .from("Sop")
      .insert({
        id: newId(),
        slug,
        type: parsed.type,
        title: parsed.title,
        body: parsed.body ?? "",
        payload: parsed.payload ?? null,
        roleScope: parsed.roleScope,
        marketScope: parsed.marketScope ?? null,
        pinned: parsed.pinned ?? false,
        order: parsed.order ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .select("*")
      .single(),
  );
  revalidatePath("/knowledge");
  return saved;
}

export async function deleteSop(id: string) {
  const { error } = await supabase.from("Sop").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/knowledge");
}

// ─── PDF import ──────────────────────────────────────────────────────────────
// Upload a PDF of one or more SOPs; Gemini reads it natively (no PDF lib needed)
// and returns structured rows we upsert. Keep the cap in sync with
// next.config.ts serverActions.bodySizeLimit.

const SOP_TYPES = new Set([
  "verbatim_classification", "source_weighting", "hook_taxonomy", "hook_rules_market",
  "deep_dive_template", "reference_format", "compliance", "block_taxonomy", "naming", "other",
]);
const ROLE_SCOPES = new Set(["all", "strategist", "copywriter", "researcher", "designer", "compliance"]);
const MAX_PDF_BYTES = 10 * 1024 * 1024;

interface ImportedSop {
  title?: string;
  type?: string;
  roleScope?: string;
  marketScope?: string | null;
  body?: string;
  payload?: unknown;
}

const IMPORT_PROMPT = [
  "You are importing Standard Operating Procedures (SOPs) from the attached document into a marketing-ops system.",
  "An SOP is a reusable rule-set, procedure, framework, or house standard that an AI agent reads and obeys.",
  "Read the ENTIRE document. Split it into distinct SOPs — one per coherent procedure/framework/rule-set. A short doc may be a single SOP.",
  "",
  "For each SOP return:",
  "  title       — concise, descriptive.",
  "  type        — closest of: verbatim_classification, source_weighting, hook_taxonomy, hook_rules_market, deep_dive_template, reference_format, compliance, block_taxonomy, naming, other. Use 'other' if unsure.",
  "  roleScope   — which agent reads it: all, strategist, copywriter, researcher, designer, compliance. Use 'all' if broad.",
  "  marketScope — a 2-letter market code (e.g. 'de') if market-specific, else null.",
  "  body        — the full SOP as clean markdown; preserve every rule, list, and step faithfully. Read verbatim by the agent.",
  "  payload     — if the SOP is structured DATA (a taxonomy, block list, scoring rubric), include it as a JSON STRING; else null.",
  "",
  "Do not invent content that isn't in the document. Return EXACTLY one JSON object, no prose, no fences:",
  '{ "sops": [ { "title": "...", "type": "...", "roleScope": "...", "marketScope": null, "body": "...", "payload": null } ] }',
].join("\n");

export async function importSopsFromPdf(
  formData: FormData,
): Promise<{ created: Array<{ id: string; title: string }> }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No PDF file provided.");
  if (file.type && file.type !== "application/pdf") throw new Error("File must be a PDF.");
  if (file.size === 0) throw new Error("That PDF is empty.");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF too large (max 10MB). Split it or raise the limit.");

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64 } },
          { text: IMPORT_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 32768,
      thinkingConfig: { thinkingBudget: 2048 },
    },
  });
  await recordUsage({
    feature: "sop_import",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    metadata: { filename: file.name },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Couldn't read any text from that PDF.");
  const parsed = extractJsonObject<{ sops?: ImportedSop[] }>(text);
  const list = Array.isArray(parsed.sops) ? parsed.sops : [];
  if (list.length === 0) throw new Error("No SOPs found in that PDF.");

  const created: Array<{ id: string; title: string }> = [];
  for (const raw of list) {
    const title = (raw.title ?? "").trim();
    if (!title) continue;
    const type = raw.type && SOP_TYPES.has(raw.type) ? raw.type : "other";
    const roleScope = raw.roleScope && ROLE_SCOPES.has(raw.roleScope) ? raw.roleScope : "all";
    const payload =
      raw.payload == null
        ? null
        : typeof raw.payload === "string"
          ? raw.payload
          : JSON.stringify(raw.payload);
    const saved = (await upsertSop({
      title,
      type,
      roleScope,
      body: (raw.body ?? "").trim(),
      payload,
      marketScope: raw.marketScope?.trim() || null,
    })) as unknown as { id: string };
    created.push({ id: saved.id, title });
  }
  if (created.length === 0) throw new Error("Parsed the PDF but found no usable SOPs.");

  revalidatePath("/knowledge");
  return { created };
}

// ─── Reference formats ───────────────────────────────────────────────────────

const ReferenceFormatSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  beats: z.string().optional().nullable(),         // JSON string
  bestForAngle: z.string().optional().nullable(),
  optimalDurationSec: z.number().optional().nullable(),
  exampleScripts: z.string().optional().nullable(), // JSON string
  order: z.number().optional(),
});

export async function upsertReferenceFormat(input: z.infer<typeof ReferenceFormatSchema>) {
  const parsed = ReferenceFormatSchema.parse(input);
  const now = new Date().toISOString();
  const fields = {
    name: parsed.name,
    description: parsed.description ?? "",
    beats: parsed.beats ?? "[]",
    bestForAngle: parsed.bestForAngle ?? null,
    optimalDurationSec: parsed.optimalDurationSec ?? null,
    exampleScripts: parsed.exampleScripts ?? null,
    order: parsed.order ?? 0,
    updatedAt: now,
  };
  if (parsed.id) {
    const saved = unwrap(
      await supabase.from("ReferenceFormat").update(fields).eq("id", parsed.id).select("*").single(),
    );
    revalidatePath("/knowledge");
    return saved;
  }
  const base = parsed.slug ? slugify(parsed.slug) : slugify(parsed.name);
  let slug = base || `format-${Date.now()}`;
  let n = 2;
  while ((await supabase.from("ReferenceFormat").select("id").eq("slug", slug).maybeSingle()).data) {
    slug = `${base}-${n++}`;
  }
  const saved = unwrap(
    await supabase
      .from("ReferenceFormat")
      .insert({ id: newId(), slug, createdAt: now, ...fields })
      .select("*")
      .single(),
  );
  revalidatePath("/knowledge");
  return saved;
}

export async function deleteReferenceFormat(id: string) {
  const { error } = await supabase.from("ReferenceFormat").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/knowledge");
}

// ─── Market profiles ─────────────────────────────────────────────────────────

const MarketProfileSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  tone: z.string().optional().nullable(),
  vocabulary: z.string().optional().nullable(),
  hooksThatWork: z.string().optional().nullable(),
  hooksThatFlop: z.string().optional().nullable(),
  allowedClaims: z.string().optional().nullable(),
  forbiddenClaims: z.string().optional().nullable(),
  disclaimerClaims: z.string().optional().nullable(),
  trustpilotScore: z.string().optional().nullable(),
  culturalNotes: z.string().optional().nullable(),
  order: z.number().optional(),
});

export async function upsertMarketProfile(input: z.infer<typeof MarketProfileSchema>) {
  const parsed = MarketProfileSchema.parse(input);
  const now = new Date().toISOString();
  const fields = {
    code: parsed.code.toLowerCase(),
    name: parsed.name,
    tone: parsed.tone ?? "",
    vocabulary: parsed.vocabulary ?? null,
    hooksThatWork: parsed.hooksThatWork ?? null,
    hooksThatFlop: parsed.hooksThatFlop ?? null,
    allowedClaims: parsed.allowedClaims ?? null,
    forbiddenClaims: parsed.forbiddenClaims ?? null,
    disclaimerClaims: parsed.disclaimerClaims ?? null,
    trustpilotScore: parsed.trustpilotScore ?? null,
    culturalNotes: parsed.culturalNotes ?? null,
    order: parsed.order ?? 0,
    updatedAt: now,
  };
  if (parsed.id) {
    const saved = unwrap(
      await supabase.from("MarketProfile").update(fields).eq("id", parsed.id).select("*").single(),
    );
    revalidatePath("/knowledge");
    return saved;
  }
  const saved = unwrap(
    await supabase
      .from("MarketProfile")
      .insert({ id: newId(), createdAt: now, ...fields })
      .select("*")
      .single(),
  );
  revalidatePath("/knowledge");
  return saved;
}

export async function deleteMarketProfile(id: string) {
  const { error } = await supabase.from("MarketProfile").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/knowledge");
}
