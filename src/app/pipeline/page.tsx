import { supabase } from "@/lib/db";
import type { ResearchRow } from "@/lib/database.types";
import { PIPELINE_STAGES } from "@/lib/cellumove/pipeline-stages";
import { PipelineIndexClient } from "./PipelineIndexClient";

export const dynamic = "force-dynamic";

interface SubOption {
  id: string;
  name: string;
  shortDesc: string | null;
  angleName: string;
}
interface RunSummary {
  id: string;
  avatarName: string | null;
  angleSlug: string | null;
  createdAt: string;
  done: number;
  total: number;
}

function countDone(drafts: string): number {
  try {
    const d = JSON.parse(drafts) as { stages?: Record<string, unknown> };
    return d.stages ? Object.values(d.stages).filter((v) => v != null).length : 0;
  } catch {
    return 0;
  }
}

export default async function PipelinePage() {
  const [anglesRes, subsRes, researchRes, runsRes] = await Promise.all([
    supabase.from("Angle").select("id, slug, name"),
    supabase.from("SubAvatar").select("id, name, shortDesc, angleId"),
    supabase.from("AvatarResearch").select("subAvatarId"),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", "pipeline")
      .order("createdAt", { ascending: false })
      .limit(30),
  ]);

  const angles = (anglesRes.data ?? []) as { id: string; slug: string; name: string }[];
  const subs = (subsRes.data ?? []) as {
    id: string;
    name: string;
    shortDesc: string | null;
    angleId: string;
  }[];
  const researched = new Set(
    ((researchRes.data ?? []) as { subAvatarId: string }[]).map((r) => r.subAvatarId),
  );
  const angleById = new Map(angles.map((a) => [a.id, a.name]));

  // Only avatars whose G1/G2 (research + deep dive) exist can enter the pipeline.
  const subOptions: SubOption[] = subs
    .filter((s) => researched.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      shortDesc: s.shortDesc,
      angleName: angleById.get(s.angleId) ?? "—",
    }));

  const runs: RunSummary[] = ((runsRes.error ? [] : (runsRes.data as Pick<ResearchRow, "id" | "focus" | "angleSlug" | "drafts" | "createdAt">[]))).map(
    (r) => ({
      id: r.id,
      avatarName: r.focus,
      angleSlug: r.angleSlug,
      createdAt: r.createdAt,
      done: countDone(r.drafts),
      total: PIPELINE_STAGES.length,
    }),
  );

  const angleOptions = angles.map((a) => ({ slug: a.slug, name: a.name }));

  return <PipelineIndexClient subOptions={subOptions} runs={runs} angles={angleOptions} />;
}
