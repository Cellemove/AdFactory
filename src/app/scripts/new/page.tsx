import type { Metadata } from "next";
import { requireStrategist } from "@/lib/authorization";
import { SCRIPT_FORMATS } from "@/lib/cellumove/script-studio";
import { PIPELINE_STAGES } from "@/lib/cellumove/pipeline-stages";
import { parsePipelineRunSelection } from "@/lib/cellumove/pipeline-selection";
import type { ResearchRow } from "@/lib/database.types";
import { supabase, unwrap } from "@/lib/db";
import {
  getTeardownConfigurationIssue,
  isTeardownConfigured,
  listTeardownDeconstructions,
} from "@/lib/teardown";
import { ScriptProjectForm } from "./ScriptProjectForm";

export const metadata: Metadata = { title: "New Script · AdFactory" };
export const dynamic = "force-dynamic";

export default async function NewScriptPage({ searchParams }: { searchParams: Promise<{ spySweepId?: string; spyAdIndex?: string }> }) {
  const query = await searchParams;
  const currentUser = await requireStrategist();
  const [products, angles, avatars, frameworks, users, pipelineRunsRaw] = await Promise.all([
    supabase
      .from("Product")
      .select("id, name, code, imagePath")
      .not("code", "is", null)
      .neq("code", "")
      .order("name")
      .then(unwrap),
    supabase.from("Angle").select("*").order("order").then(unwrap),
    supabase.from("SubAvatar").select("*").order("name").then(unwrap),
    supabase.from("ReferenceFormat").select("*").order("order").then(unwrap),
    supabase.from("AppUser").select("*").order("username").then(unwrap),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", "pipeline")
      .order("createdAt", { ascending: false })
      .limit(100)
      .then(unwrap),
  ]);

  const avatarById = new Map(avatars.map((avatar) => [avatar.id, avatar]));
  const angleBySlug = new Map(angles.map((angle) => [angle.slug, angle]));
  const pipelineRuns = (pipelineRunsRaw as Pick<ResearchRow, "id" | "focus" | "angleSlug" | "drafts" | "createdAt">[]).flatMap((run) => {
    try {
      const doc = parsePipelineRunSelection(run.drafts);
      if (!doc) return [];
      const avatar = avatarById.get(doc.subAvatarId);
      const angle = run.angleSlug ? angleBySlug.get(run.angleSlug) : null;
      const completedStages = doc.completedStages;
      if (!avatar || !angle || completedStages === 0) return [];
      return [{
        id: run.id,
        subAvatarId: avatar.id,
        angleId: angle.id,
        name: `${avatar.name} · ${angle.name} · ${completedStages}/${PIPELINE_STAGES.length} stages · ${new Date(run.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      }];
    } catch {
      return [];
    }
  });

  let teardowns: Awaited<ReturnType<typeof listTeardownDeconstructions>> = [];
  const teardownConfigured = isTeardownConfigured();
  let teardownWarning: string | null = getTeardownConfigurationIssue();
  if (teardownConfigured) {
    try {
      teardowns = await listTeardownDeconstructions();
    } catch (error) {
      teardownWarning = error instanceof Error ? error.message : String(error);
    }
  }

  let spyIdea: { sweepId: string; adIndex: number; idea: string; title: string; creativeName: string; productId?: string; angleId?: string } | null = null;
  if (query.spySweepId && /^\d+$/.test(query.spyAdIndex ?? "")) {
    const row = await supabase.from("Research").select("id, drafts, queryPlan").eq("id", query.spySweepId).eq("type", "competitor_spy").maybeSingle();
    if (row.data) {
      try {
        const adIndex = Number(query.spyAdIndex);
        const ad = JSON.parse(row.data.drafts)?.[adIndex] as { brand?: string; caption?: string } | undefined;
        if (ad?.caption?.trim()) {
          const haystack = `${ad.brand ?? ""} ${ad.caption}`.toLocaleLowerCase();
          const score = (value: string) => value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && haystack.includes(word)).length;
          const product = [...products].sort((a, b) => score(b.name) - score(a.name))[0];
          const angle = [...angles].sort((a, b) => score(`${b.name} ${b.requiredKeyword ?? ""}`) - score(`${a.name} ${a.requiredKeyword ?? ""}`))[0];
          spyIdea = {
            sweepId: row.data.id,
            adIndex,
            idea: ad.caption.trim(),
            title: `${ad.brand?.trim() || "Competitor"} inspired concept`,
            creativeName: `${ad.brand?.trim() || "SPY"} IDEA`.toUpperCase().slice(0, 120),
            productId: product && score(product.name) > 0 ? product.id : undefined,
            angleId: angle && score(`${angle.name} ${angle.requiredKeyword ?? ""}`) > 0 ? angle.id : undefined,
          };
        }
      } catch {
        // Invalid or legacy sweep data simply opens an empty form.
      }
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create script project</h1>
        <p className="mt-1 text-sm text-ink-500">Choose the strategy inputs first; AI uses your product, avatar research, verbatims, knowledge, winners, Teardown, and B-roll to deliver a complete editable first draft.</p>
      </header>
      <ScriptProjectForm
        products={products
          .filter((item) => item.code?.trim())
          .map((item) => ({ id: item.id, name: item.name, code: item.code!.trim(), imagePath: item.imagePath }))}
        angles={angles.map((item) => ({ id: item.id, slug: item.slug, name: item.name }))}
        avatars={avatars.map((item) => ({ id: item.id, angleId: item.angleId, name: item.name }))}
        pipelineRuns={pipelineRuns}
        frameworks={frameworks.map((item) => ({ id: item.id, name: item.name, duration: item.optimalDurationSec }))}
        strategists={users.filter((item) => item.role === "creative_strategist").map((item) => ({ id: item.id, name: item.username }))}
        editors={users.filter((item) => item.role === "editor").map((item) => ({ id: item.id, name: item.username }))}
        teardowns={teardowns.map((item) => ({
          id: item.id,
          name: `${item.ad_name || item.original_filename} · ${item.platform || item.ad_kind} · ${item.field_count} insights`,
        }))}
        formats={[...SCRIPT_FORMATS]}
        currentUserId={currentUser.id}
        teardownConfigured={teardownConfigured}
        teardownWarning={teardownWarning}
        initialValues={spyIdea}
      />
    </div>
  );
}
