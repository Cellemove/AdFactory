import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase, unwrapOpt } from "@/lib/db";
import { AngleDraftCard, SubAvatarDraftCard, ConceptDraftCard } from "../DraftCards";
import type {
  ResearchedAngleDraft,
  ResearchedAvatarDraft,
  ResearchedConceptDraft,
} from "../../actions/research";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  angle: "Angle research",
  sub_avatar: "Sub-avatar research",
  concept: "Concept research",
};

export default async function ResearchDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [researchRes, anglesRes] = await Promise.all([
    supabase.from("Research").select("*").eq("id", id).maybeSingle(),
    supabase.from("Angle").select("*").order("order", { ascending: true }),
  ]);

  // Research table missing → behave like 404.
  if (researchRes.error && /relation .* does not exist|does not exist/i.test(researchRes.error.message)) {
    notFound();
  }
  const research = unwrapOpt(researchRes);
  if (!research) notFound();

  const angles = anglesRes.data ?? [];
  const angle = angles.find((a) => a.slug === research.angleSlug);

  let drafts: unknown[] = [];
  try {
    const parsed = JSON.parse(research.drafts);
    if (Array.isArray(parsed)) drafts = parsed;
  } catch { /* ignore — empty list shown */ }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/research" className="text-xs text-ink-500 hover:text-ink-900">← All research</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {TYPE_LABEL[research.type] ?? research.type}
              {angle ? ` · ${angle.name}` : ""}
            </h1>
            <p className="text-sm text-ink-500">
              {drafts.length} drafts · saved {new Date(research.createdAt).toLocaleString()}
              {research.focus ? ` · focus: "${research.focus}"` : ""}
            </p>
          </div>
        </div>
      </header>

      {drafts.length === 0 ? (
        <div className="card text-sm text-ink-500">
          This research has no drafts (the JSON failed to parse or the model returned an empty list).
        </div>
      ) : (
        <section className="space-y-2">
          <div className="text-xs text-ink-500">
            Save buttons work the same as in the live session. Re-saving a draft creates a new record
            with an auto-suffixed slug, so it&apos;s safe to click even if you forget what you already saved.
          </div>
          {research.type === "angle" &&
            (drafts as ResearchedAngleDraft[]).map((d, i) => <AngleDraftCard key={i} draft={d} />)}
          {research.type === "sub_avatar" && research.angleSlug &&
            (drafts as ResearchedAvatarDraft[]).map((d, i) => (
              <SubAvatarDraftCard key={i} draft={d} angleSlug={research.angleSlug!} />
            ))}
          {research.type === "concept" &&
            (drafts as ResearchedConceptDraft[]).map((d, i) => <ConceptDraftCard key={i} draft={d} />)}
        </section>
      )}
    </div>
  );
}
