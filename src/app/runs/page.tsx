import Link from "next/link";
import { supabase, unwrap } from "@/lib/db";
import type { RunRow, AngleRow, BriefRow, SubAvatarRow, WinningAdRow, BigSwingRow, GenerationRow, ResearchRow } from "@/lib/database.types";
import { PIPELINE_STAGES } from "@/lib/cellumove/pipeline-stages";

type RunWithJoins = RunRow & {
  angle: AngleRow;
  brief: BriefRow & { subAvatar: SubAvatarRow | null; parentWinner: WinningAdRow | null; bigSwing: BigSwingRow | null };
  generations: GenerationRow[];
};

export const dynamic = "force-dynamic";

type HistoryItem = {
  key: string;
  kind: "pipeline" | "excavation" | "legacy";
  href: string;
  title: string;
  subtitle: string;
  date: string;
  tags: React.ReactNode;
};

function countDone(drafts: string): number {
  try {
    const d = JSON.parse(drafts) as { stages?: Record<string, unknown> };
    return d.stages ? Object.values(d.stages).filter((v) => v != null).length : 0;
  } catch {
    return 0;
  }
}

function subAvatarCount(drafts: string): number {
  try {
    return (JSON.parse(drafts) as { subAvatars?: unknown[] }).subAvatars?.length ?? 0;
  } catch {
    return 0;
  }
}

const KIND_LABEL: Record<HistoryItem["kind"], string> = {
  pipeline: "Pipeline",
  excavation: "Excavation · G1",
  legacy: "Legacy run",
};

export default async function HistoryPage() {
  const [runsRes, researchRes] = await Promise.all([
    supabase
      .from("Run")
      .select(
        "*, angle:Angle(*), brief:Brief(*, subAvatar:SubAvatar(*), parentWinner:WinningAd(*), bigSwing:BigSwing(*)), generations:Generation(*)",
      )
      .order("startedAt", { ascending: false })
      .limit(100),
    supabase
      .from("Research")
      .select("id, type, focus, angleSlug, drafts, createdAt")
      .in("type", ["pipeline", "excavation"])
      .order("createdAt", { ascending: false })
      .limit(100),
  ]);
  const runs = unwrap(runsRes) as RunWithJoins[];
  const research = ((researchRes.error
    ? []
    : (researchRes.data as Pick<ResearchRow, "id" | "type" | "focus" | "angleSlug" | "drafts" | "createdAt">[])) ?? []);

  const items: HistoryItem[] = [
    ...research.map((r): HistoryItem => {
      if (r.type === "pipeline") {
        const done = countDone(r.drafts);
        return {
          key: `p-${r.id}`,
          kind: "pipeline",
          href: `/pipeline/${r.id}`,
          title: r.focus || "Pipeline run",
          subtitle: r.angleSlug ? `${r.angleSlug} · G1→G7 build` : "G1→G7 build",
          date: r.createdAt,
          tags: (
            <span className={`tag ${done >= PIPELINE_STAGES.length ? "tag-ok" : ""}`}>
              {done}/{PIPELINE_STAGES.length} stages
            </span>
          ),
        };
      }
      return {
        key: `e-${r.id}`,
        kind: "excavation",
        href: `/pipeline?excavation=${r.id}`,
        title: r.focus || "Avatar excavation",
        subtitle: "Verbatim scrape → avatar map",
        date: r.createdAt,
        tags: <span className="tag">{subAvatarCount(r.drafts)} sub-avatars</span>,
      };
    }),
    ...runs.map((r): HistoryItem => {
      const blocks = r.generations.filter((g) => g.complianceStatus === "block").length;
      const warns = r.generations.filter((g) => g.complianceStatus === "warn").length;
      const approved = r.generations.filter((g) => g.verdict === "approved").length;
      return {
        key: `r-${r.id}`,
        kind: "legacy",
        href: `/runs/${r.id}`,
        title: `${r.angle.name} · ${r.brief.subAvatar?.name ?? "generic"}`,
        subtitle:
          (r.brief.lane === "iterate"
            ? `Iterate ← ${r.brief.parentWinner?.adName ?? "—"} · ${r.brief.iterationVar ?? ""}`
            : `Big Swing → ${r.brief.bigSwing?.name ?? "—"}${r.brief.hookMechanic ? ` · ${r.brief.hookMechanic}` : ""}`) +
          ` · ${r.brief.funnel}`,
        date: r.startedAt,
        tags: (
          <>
            <span className={`tag ${r.status === "complete" ? "tag-ok" : r.status === "failed" ? "tag-danger" : "tag-warn"}`}>{r.status}</span>
            <span className="tag">{r.generations.length}/{r.brief.targetCount} prompts</span>
            {blocks > 0 && <span className="tag tag-danger">{blocks} block</span>}
            {warns > 0 && <span className="tag tag-warn">{warns} warn</span>}
            {approved > 0 && <span className="tag tag-ok">{approved} approved</span>}
          </>
        ),
      };
    }),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-ink-500">
          Everything generated — pipeline builds, avatar excavations, and legacy prompt runs.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="card text-sm text-ink-500">
          Nothing generated yet. <Link href="/pipeline" className="underline">Start a pipeline.</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="card flex flex-wrap items-center justify-between gap-2 hover:border-ink-900">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-plum">
                      {KIND_LABEL[it.kind]}
                    </span>
                    <span className="text-sm font-medium">{it.title}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {it.subtitle} · {new Date(it.date).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">{it.tags}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
