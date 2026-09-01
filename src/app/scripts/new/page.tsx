import type { Metadata } from "next";
import { requireStrategist } from "@/lib/authorization";
import { SCRIPT_FORMATS } from "@/lib/cellumove/script-studio";
import { PIPELINE_STAGES } from "@/lib/cellumove/pipeline-stages";
import { parsePipelineRunSelection } from "@/lib/cellumove/pipeline-selection";
import type { ResearchRow } from "@/lib/database.types";
import { supabase, unwrap } from "@/lib/db";
import { isTeardownConfigured, listTeardownDeconstructions } from "@/lib/teardown";
import { ScriptProjectForm } from "./ScriptProjectForm";

export const metadata: Metadata = { title: "New Script · AdFactory" };
export const dynamic = "force-dynamic";

export default async function NewScriptPage() {
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
  let teardownWarning: string | null = null;
  if (isTeardownConfigured()) {
    try {
      teardowns = await listTeardownDeconstructions();
    } catch (error) {
      teardownWarning = error instanceof Error ? error.message : String(error);
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
        teardownConfigured={isTeardownConfigured()}
        teardownWarning={teardownWarning}
      />
    </div>
  );
}
