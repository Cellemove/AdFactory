import Link from "next/link";
import { supabase } from "@/lib/db";
import type {
  ResearchRow,
  SubAvatarRow,
  AvatarResearchRow,
  AngleRow,
} from "@/lib/database.types";
import type { StageVerification } from "../../actions/pipeline-run";
import { PipelineStepper } from "./PipelineStepper";

export const dynamic = "force-dynamic";
// Each deep-dive pass does live scraping + a grounded Gemini call; give server
// actions from this route room to breathe on Vercel (no effect locally).
export const maxDuration = 300;

interface Doc {
  subAvatarId: string;
  angleSlug: string;
  stages: Record<string, unknown>;
  verification: Record<string, unknown>;
}

function parseDoc(raw: string): Doc {
  try {
    const d = JSON.parse(raw) as Partial<Doc>;
    return {
      subAvatarId: d.subAvatarId ?? "",
      angleSlug: d.angleSlug ?? "",
      stages: d.stages && typeof d.stages === "object" ? (d.stages as Record<string, unknown>) : {},
      verification:
        d.verification && typeof d.verification === "object" ? (d.verification as Record<string, unknown>) : {},
    };
  } catch {
    return { subAvatarId: "", angleSlug: "", stages: {}, verification: {} };
  }
}

export default async function PipelineRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = (await supabase
    .from("Research")
    .select("*")
    .eq("id", id)
    .eq("type", "pipeline")
    .maybeSingle()).data as ResearchRow | null;

  if (!row) {
    return (
      <div className="card text-sm text-ink-600">
        Pipeline run not found.{" "}
        <Link href="/pipeline" className="underline hover:text-ink-900">
          Back to pipelines
        </Link>
      </div>
    );
  }

  const doc = parseDoc(row.drafts);

  const sub = (await supabase
    .from("SubAvatar")
    .select("*")
    .eq("id", doc.subAvatarId)
    .maybeSingle()).data as SubAvatarRow | null;
  const research = sub
    ? ((await supabase
        .from("AvatarResearch")
        .select("*")
        .eq("subAvatarId", sub.id)
        .maybeSingle()).data as AvatarResearchRow | null)
    : null;
  const angle = (await supabase
    .from("Angle")
    .select("*")
    .eq("slug", doc.angleSlug)
    .maybeSingle()).data as AngleRow | null;

  const g1 = research
    ? {
        painPoints: research.painPoints,
        desires: research.desires,
        objections: research.objections,
        dailyLanguage: research.dailyLanguage,
        triggers: research.triggers,
        identity: research.identity,
        socialProof: research.socialProof,
        buyingContext: research.buyingContext,
      }
    : null;

  return (
    <PipelineStepper
      runId={id}
      avatarName={sub?.name ?? row.focus ?? "Avatar"}
      angleName={angle?.name ?? doc.angleSlug}
      g1={g1}
      initialOutputs={doc.stages}
      initialVerifications={doc.verification as Record<string, StageVerification | undefined>}
    />
  );
}
