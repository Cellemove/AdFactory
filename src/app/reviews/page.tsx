import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/db";
import type { EditorClaimRow, ResearchRow } from "@/lib/database.types";
import { ReviewsClient } from "./ReviewsClient";

export const dynamic = "force-dynamic";

function stagesOf(drafts: string): Record<string, unknown> {
  try {
    return (JSON.parse(drafts) as { stages?: Record<string, unknown> }).stages ?? {};
  } catch {
    return {};
  }
}

export default async function ReviewsPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  const [claimsRes, runsRes] = await Promise.all([
    supabase.from("EditorClaim").select("*").order("updatedAt", { ascending: false }),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", "pipeline")
      .order("createdAt", { ascending: false })
      .limit(60),
  ]);

  const tableMissing = Boolean(claimsRes.error);
  const claims = (tableMissing ? [] : (claimsRes.data as EditorClaimRow[])) ?? [];
  const claimedRunIds = new Set(claims.map((c) => c.runId));
  const runs = (runsRes.error ? [] : (runsRes.data as Pick<ResearchRow, "id" | "focus" | "angleSlug" | "drafts" | "createdAt">[])) ?? [];

  // The deliverable each editor reads = the pipeline's Creative Briefs (+ Ad Scripts).
  const deliverableByRun: Record<string, { creativeBriefs?: unknown; adScripts?: unknown }> = {};
  const claimable: { runId: string; label: string; createdAt: string }[] = [];
  for (const r of runs) {
    const st = stagesOf(r.drafts);
    deliverableByRun[r.id] = { creativeBriefs: st.creativeBriefs, adScripts: st.adScripts };
    if (st.creativeBriefs != null && !claimedRunIds.has(r.id)) {
      claimable.push({
        runId: r.id,
        label: `${r.focus ?? "Avatar"}${r.angleSlug ? ` · ${r.angleSlug}` : ""}`,
        createdAt: r.createdAt,
      });
    }
  }

  const claimsWithWork = claims.map((c) => ({ ...c, deliverable: deliverableByRun[c.runId] ?? {} }));

  return (
    <ReviewsClient me={me} claims={claimsWithWork} claimable={claimable} tableMissing={tableMissing} />
  );
}
