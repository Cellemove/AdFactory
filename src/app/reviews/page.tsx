import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { parseScriptDocument } from "@/lib/cellumove/script-studio";
import { normalizeScriptWorkflowStatus } from "@/lib/cellumove/script-workflow";
import { supabase } from "@/lib/db";
import type { AppUserRow, BrollSuggestionRow, EditorClaimRow, ProductRow, ResearchRow, ScriptAssignmentRow, ScriptProjectRow, ScriptSourceRow, ScriptVersionRow } from "@/lib/database.types";
import { readShopifyProductMetadata } from "@/lib/shopify";
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

  const [claimsRes, runsRes, scriptAssignmentsRes, scriptProjectsRes, usersRes, versionsRes, sourcesRes, productsRes, brollUsageRes] = await Promise.all([
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
    supabase.from("ScriptVersion").select("*").eq("origin", "assigned").order("version", { ascending: false }),
    supabase.from("ScriptSource").select("*").order("createdAt", { ascending: true }),
    supabase.from("Product").select("*"),
    supabase.from("BrollSuggestion").select("*").eq("source", "script_studio_used"),
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
  const versions = (versionsRes.data ?? []) as ScriptVersionRow[];
  const sources = (sourcesRes.data ?? []) as ScriptSourceRow[];
  const products = (productsRes.data ?? []) as ProductRow[];
  const brollUsage = (brollUsageRes.data ?? []) as BrollSuggestionRow[];
  const userById = new Map(users.map((user) => [user.id, user]));
  const projectById = new Map(scriptProjects.map((project) => [project.id, project]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const scriptPackages = scriptAssignments.flatMap((assignment) => {
    const project = projectById.get(assignment.projectId);
    if (!project) return [];
    const handoff = versions.find((version) => version.projectId === project.id);
    // Video editors only receive explicit, immutable handoff snapshots. The
    // strategist's live working document never appears in the production queue.
    if (!handoff) return [];
    const document = parseScriptDocument(handoff.document);
    const product = productById.get(project.productId) ?? null;
    const shopify = readShopifyProductMetadata(product?.context);
    const imageCandidates = [
      ...(product?.imagePath ? [{ url: product.imagePath, altText: product.name }] : []),
      ...(shopify?.images ?? []).map((image) => ({ url: image.url, altText: image.altText ?? product?.name ?? document.product.name })),
    ];
    const productImages = imageCandidates.filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index);
    return [{
      projectId: project.id,
      title: project.title,
      displayName: project.displayName,
      document,
      handoffVersion: handoff.version,
      status: normalizeScriptWorkflowStatus(project.status, assignment.status),
      editorUserId: assignment.editorUserId,
      editorName: assignment.editorUserId ? userById.get(assignment.editorUserId)?.username ?? null : null,
      deliveryUrl: assignment.deliveryUrl,
      reviewNote: assignment.reviewNote,
      product: {
        name: product?.name ?? document.product.name,
        code: product?.code ?? document.product.code,
        description: product?.description ?? null,
        images: productImages,
      },
      sources: sources.filter((source) => source.projectId === project.id).map((source) => ({
        type: source.sourceType,
        title: source.title,
        url: source.url,
      })),
      usedBrollClipIds: brollUsage.filter((usage) => usage.refId === project.id).map((usage) => usage.clipId),
      updatedAt: assignment.updatedAt,
    }];
  });

  return (
    <ReviewsClient me={me} claims={claimsWithWork} claimable={claimable} tableMissing={tableMissing} scriptPackages={scriptPackages} scriptTableMissing={scriptTableMissing} />
  );
}
