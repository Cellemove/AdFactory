import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/db";
import type { AppUserRow, EditorClaimRow, ResearchRow, ScriptAssignmentRow, ScriptProjectRow } from "@/lib/database.types";
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

  const [claimsRes, runsRes, scriptAssignmentsRes, scriptProjectsRes, usersRes] = await Promise.all([
    supabase.from("EditorClaim").select("*").order("updatedAt", { ascending: false }),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", "pipeline")
      .order("createdAt", { ascending: false })
      .limit(60),
    supabase.from("ScriptAssignment").select("*").order("updatedAt", { ascending: false }),
    supabase.from("ScriptProject").select("*").order("updatedAt", { ascending: false }),
    supabase.from("AppUser").select("*").order("username"),
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
  const scriptTableMissing = Boolean(scriptAssignmentsRes.error || scriptProjectsRes.error);
  const scriptProjects = (scriptTableMissing ? [] : scriptProjectsRes.data ?? []) as ScriptProjectRow[];
  const scriptAssignments = (scriptTableMissing ? [] : scriptAssignmentsRes.data ?? []) as ScriptAssignmentRow[];
  const users = (usersRes.data ?? []) as AppUserRow[];
  const userById = new Map(users.map((user) => [user.id, user]));
  const projectById = new Map(scriptProjects.map((project) => [project.id, project]));
  const scriptPackages = scriptAssignments.flatMap((assignment) => {
    const project = projectById.get(assignment.projectId);
    if (!project) return [];
    return [{
      projectId: project.id,
      title: project.title,
      displayName: project.displayName,
      document: project.document,
      status: assignment.status,
      editorUserId: assignment.editorUserId,
      editorName: assignment.editorUserId ? userById.get(assignment.editorUserId)?.username ?? null : null,
      deliveryUrl: assignment.deliveryUrl,
      reviewNote: assignment.reviewNote,
      updatedAt: assignment.updatedAt,
    }];
  });

  return (
    <ReviewsClient me={me} claims={claimsWithWork} claimable={claimable} tableMissing={tableMissing} scriptPackages={scriptPackages} scriptTableMissing={scriptTableMissing} />
  );
}
