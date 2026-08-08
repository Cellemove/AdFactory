import Link from "next/link";
import { supabase, unwrap } from "@/lib/db";
import type { RunRow, AngleRow, BriefRow, SubAvatarRow, WinningAdRow, BigSwingRow, GenerationRow } from "@/lib/database.types";

type RunWithJoins = RunRow & {
  angle: AngleRow;
  brief: BriefRow & { subAvatar: SubAvatarRow | null; parentWinner: WinningAdRow | null; bigSwing: BigSwingRow | null };
  generations: GenerationRow[];
};

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runsRes = await supabase
    .from("Run")
    .select(
      "*, angle:Angle(*), brief:Brief(*, subAvatar:SubAvatar(*), parentWinner:WinningAd(*), bigSwing:BigSwing(*)), generations:Generation(*)",
    )
    .order("startedAt", { ascending: false })
    .limit(100);
  const runs = unwrap(runsRes) as RunWithJoins[];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-ink-500">Each run = one brief × N prompts × 10-gate compliance.</p>
        </div>
        <Link href="/new" className="btn btn-primary">+ New Run</Link>
      </header>

      {runs.length === 0 ? (
        <div className="card text-sm text-ink-500">No runs yet.</div>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => {
            const blocks = r.generations.filter((g) => g.complianceStatus === "block").length;
            const warns = r.generations.filter((g) => g.complianceStatus === "warn").length;
            const approved = r.generations.filter((g) => g.verdict === "approved").length;
            return (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="card flex flex-wrap items-center justify-between gap-2 hover:border-ink-900">
                  <div>
                    <div className="text-sm font-medium">
                      {r.angle.name} · {r.brief.subAvatar?.name ?? "generic"}
                    </div>
                    <div className="text-xs text-ink-500">
                      {r.brief.lane === "iterate"
                        ? `Iterate ← ${r.brief.parentWinner?.adName ?? "—"} · ${r.brief.iterationVar ?? ""}`
                        : `Big Swing → ${r.brief.bigSwing?.name ?? "—"}${r.brief.hookMechanic ? ` · ${r.brief.hookMechanic}` : ""}`}
                      {" · "} {r.brief.funnel} {" · "} started {new Date(r.startedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`tag ${r.status === "complete" ? "tag-ok" : r.status === "failed" ? "tag-danger" : "tag-warn"}`}>{r.status}</span>
                    <span className="tag">{r.generations.length}/{r.brief.targetCount} prompts</span>
                    {blocks > 0 && <span className="tag tag-danger">{blocks} block</span>}
                    {warns > 0 && <span className="tag tag-warn">{warns} warn</span>}
                    {approved > 0 && <span className="tag tag-ok">{approved} approved</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
