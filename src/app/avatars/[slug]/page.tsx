import { notFound } from "next/navigation";
import { supabase, unwrapOpt } from "@/lib/db";
import type { SubAvatarRow, AngleRow, AvatarResearchRow } from "@/lib/database.types";
import { ResearchForm } from "./ResearchForm";
import Link from "next/link";

type SubWithAngleResearch = SubAvatarRow & { angle: AngleRow; research: AvatarResearchRow | null };

export const dynamic = "force-dynamic";

export default async function SubAvatarPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const subRes = await supabase
    .from("SubAvatar")
    .select("*, angle:Angle(*), research:AvatarResearch(*)")
    .eq("slug", slug)
    .maybeSingle();
  const sub = unwrapOpt(subRes) as SubWithAngleResearch | null;
  if (!sub) notFound();

  return (
    <div className="space-y-5">
      <header>
        <Link href="/avatars" className="text-xs text-ink-500 hover:text-ink-900">← All avatars</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{sub.name}</h1>
            <p className="text-sm text-ink-500">
              {sub.angle.name} · {sub.angle.silhouette} · {sub.angle.colorway}
            </p>
          </div>
          <span className={`tag ${sub.research ? "tag-ok" : "tag-danger"}`}>
            {sub.research ? "research saved" : "no research"}
          </span>
        </div>
      </header>

      <ResearchForm
        subAvatarId={sub.id}
        initial={
          sub.research
            ? {
                painPoints: sub.research.painPoints,
                desires: sub.research.desires,
                objections: sub.research.objections,
                dailyLanguage: sub.research.dailyLanguage,
                triggers: sub.research.triggers,
                identity: sub.research.identity,
                socialProof: sub.research.socialProof,
                buyingContext: sub.research.buyingContext,
                notes: sub.research.notes ?? "",
              }
            : null
        }
      />
    </div>
  );
}
