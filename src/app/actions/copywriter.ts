"use server";

// The interactive copywriter workbench. A session = one Research row
// (type "copywriter") whose `drafts` holds the conversation as JSON — the same
// zero-migration trick the pipeline and Spy use. Each ask is one runAgent call
// under the "copywriter" role, so copywriter SOPs from /knowledge apply here too.

import { revalidatePath } from "next/cache";
import { supabase, unwrapOpt, newId } from "@/lib/db";
import { runAgent } from "@/lib/cellumove/agents";
import { loadAvatarContext, researchBlock, deepDiveBlock } from "@/lib/cellumove/context";
import { renderCopywriterProfile } from "@/lib/cellumove/avatar-profile";
import { BRAND_BASE, CLAIMS_GUARDRAIL } from "@/lib/cellumove/pipeline-stages";
import { scanClaims, type ClaimScan } from "@/lib/cellumove/claim-check";
import { parseCopySessionDoc, type CopySessionDoc } from "@/lib/cellumove/copy-session";
import type { ResearchRow } from "@/lib/database.types";

const INSTRUCTION = [
  "You are the CelluMove COPYWRITER in a live working session with a creative strategist.",
  BRAND_BASE,
  "",
  "RULES:",
  "• Deliver exactly what the strategist asks for — hooks, headlines, ad scripts, Meta primary texts, rewrites, punch-ups. Output the deliverable itself in clean markdown: no preamble, no sign-off, no meta commentary.",
  "• Sound like the avatar, never like a marketer: use her register, her exact phrases, the real verbatims provided. Never use her rejected clichés.",
  "• Build on the assets provided when present (deep-dive research, copy arsenal, brand DNA, mechanism) — reuse their proven hooks and language instead of inventing from scratch.",
  "• On follow-ups, revise your previous deliverable in place — keep what wasn't questioned, change what was.",
  CLAIMS_GUARDRAIL,
].join("\n");

// Newest pipeline outputs for this avatar, so the copywriter builds on them:
// G2 deep dive (verbatims), G4 copy arsenal, brand DNA, G3 mechanism. Scans
// newest-first across runs; first non-null of each wins (a fresh run may only
// have its deep dive done while an older one holds the arsenal). Fail-soft.
async function pipelineAssets(avatarName: string): Promise<{ deepDive: unknown; blocks: string }> {
  const found: { deepDive?: unknown; copyArsenal?: unknown; brandDna?: unknown; mechanism?: unknown } = {};
  try {
    const res = await supabase
      .from("Research")
      .select("drafts")
      .eq("type", "pipeline")
      .eq("focus", avatarName)
      .order("createdAt", { ascending: false })
      .limit(6);
    if (!res.error) {
      for (const row of (res.data ?? []) as { drafts: string }[]) {
        let stages: Record<string, unknown> = {};
        try {
          stages = (JSON.parse(row.drafts) as { stages?: Record<string, unknown> }).stages ?? {};
        } catch {
          continue;
        }
        found.deepDive ??= stages.deepDive ?? undefined;
        found.copyArsenal ??= stages.copyArsenal ?? undefined;
        found.brandDna ??= stages.brandDna ?? undefined;
        found.mechanism ??= (stages.rootCause as { mechanism?: unknown } | undefined)?.mechanism ?? undefined;
      }
    }
  } catch {
    /* no pipeline runs yet — the session still works on G1 research alone */
  }
  const blocks = [
    found.copyArsenal
      ? `COPY ARSENAL (G4) — the reusable copy bank for this avatar:\n${JSON.stringify(found.copyArsenal, null, 1)}`
      : "",
    found.brandDna ? `BRAND DNA for this funnel:\n${JSON.stringify(found.brandDna, null, 1)}` : "",
    found.mechanism ? `MECHANISM (G3):\n${JSON.stringify(found.mechanism, null, 1)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { deepDive: found.deepDive, blocks };
}

export async function createCopySession(subAvatarId: string): Promise<{ sessionId: string }> {
  if (!subAvatarId) throw new Error("Pick a sub-avatar to open a session.");
  const ctx = await loadAvatarContext(subAvatarId); // validates G1 readiness
  const id = newId();
  const doc: CopySessionDoc = { subAvatarId, angleSlug: ctx.angle.slug, turns: [] };
  const res = await supabase.from("Research").insert({
    id,
    type: "copywriter",
    angleSlug: ctx.angle.slug,
    focus: ctx.sub.name,
    drafts: JSON.stringify(doc),
    status: "open",
    createdAt: new Date().toISOString(),
  });
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/copywriter");
  return { sessionId: id };
}

export async function deleteCopySession(sessionId: string): Promise<void> {
  const res = await supabase.from("Research").delete().eq("id", sessionId).eq("type", "copywriter");
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/copywriter");
}

// ponytail: whole-history replay capped by count/chars, no summarization — revisit
// if sessions outgrow the context window in practice.
const HISTORY_TURNS = 12;
const HISTORY_TURN_CHARS = 6000;

export async function askCopywriter(
  sessionId: string,
  message: string,
): Promise<{ reply: string; claims: ClaimScan; at: string }> {
  const text = message.trim();
  if (!text) throw new Error("Type a request for the copywriter.");

  const row = unwrapOpt(
    await supabase.from("Research").select("*").eq("id", sessionId).eq("type", "copywriter").maybeSingle(),
  ) as ResearchRow | null;
  if (!row) throw new Error("Copywriter session not found.");
  const doc = parseCopySessionDoc(row.drafts);

  const ctx = await loadAvatarContext(doc.subAvatarId);
  const assets = await pipelineAssets(ctx.sub.name);

  const history = doc.turns
    .slice(-HISTORY_TURNS)
    .map((t) => {
      const body = t.text.length > HISTORY_TURN_CHARS ? `${t.text.slice(0, HISTORY_TURN_CHARS)}…` : t.text;
      return `${t.role === "user" ? "STRATEGIST" : "COPYWRITER"}:\n${body}`;
    })
    .join("\n\n");

  const context = [
    researchBlock(ctx),
    renderCopywriterProfile(ctx.profile),
    deepDiveBlock(assets.deepDive),
    assets.blocks,
    history ? `SESSION SO FAR:\n\n${history}` : "",
    `STRATEGIST:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = (
    await runAgent({
      role: "copywriter",
      instruction: INSTRUCTION,
      context,
      feature: "copywriter_session",
      metadata: { sessionId, subAvatarId: doc.subAvatarId },
      maxOutputTokens: 16384,
    })
  ).trim();

  const claims = scanClaims(reply);
  const at = new Date().toISOString();

  // Re-read before writing so a concurrent ask (same session in another tab)
  // that landed during our long model call isn't clobbered — append to the
  // freshest doc. Same pattern as pipeline-run's reloadDoc.
  const freshRes = await supabase
    .from("Research")
    .select("drafts")
    .eq("id", sessionId)
    .eq("type", "copywriter")
    .maybeSingle();
  const fresh =
    !freshRes.error && freshRes.data
      ? parseCopySessionDoc((freshRes.data as { drafts: string }).drafts)
      : doc;
  fresh.turns.push({ role: "user", text, at }, { role: "copywriter", text: reply, at, claims });

  const upd = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(fresh) })
    .eq("id", sessionId)
    .eq("type", "copywriter");
  if (upd.error) throw new Error(upd.error.message);

  revalidatePath("/copywriter");
  return { reply, claims, at };
}
