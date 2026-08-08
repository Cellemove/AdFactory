import Link from "next/link";
import { supabase, unwrap } from "@/lib/db";
import type { RunRow, AngleRow, BriefRow, SubAvatarRow, GenerationRow } from "@/lib/database.types";
import { isLLMConfigured } from "@/lib/llm";

type RecentRun = RunRow & {
  angle: AngleRow;
  brief: BriefRow & { subAvatar: SubAvatarRow | null };
  generations: GenerationRow[];
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [
    angleCountRes,
    avatarCountRes,
    winnerCountRes,
    runCountRes,
    recentRunsRes,
    principlesRes,
  ] = await Promise.all([
    supabase.from("Angle").select("*", { count: "exact", head: true }),
    supabase.from("SubAvatar").select("*", { count: "exact", head: true }),
    supabase.from("WinningAd").select("*", { count: "exact", head: true }),
    supabase.from("Run").select("*", { count: "exact", head: true }),
    supabase
      .from("Run")
      .select(
        "*, angle:Angle(*), brief:Brief(*, subAvatar:SubAvatar(*)), generations:Generation(*)",
      )
      .order("startedAt", { ascending: false })
      .limit(6),
    supabase
      .from("CopyPrinciple")
      .select("*")
      .eq("category", "kill")
      .order("order", { ascending: true }),
  ]);
  const angleCount = angleCountRes.count ?? 0;
  const avatarCount = avatarCountRes.count ?? 0;
  const winnerCount = winnerCountRes.count ?? 0;
  const runCount = runCountRes.count ?? 0;
  const recentRuns = unwrap(recentRunsRes) as RecentRun[];
  const principles = unwrap(principlesRes);

  const apiOk = isLLMConfigured();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-ink-500">Iterate winners. Swing big. Kill on schedule.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/research" className="btn">Start Research</Link>
          <Link href="/new" className="btn btn-primary">+ New Run</Link>
        </div>
      </header>

      {!apiOk && (
        <div className="card border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>GOOGLE_CLOUD_PROJECT not set.</strong> Add it to <code>.env</code> and restart the
            dev server to enable prompt generation.
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Angles" value={angleCount} href="/avatars" />
        <Stat label="Sub-avatars" value={avatarCount} href="/avatars" />
        <Stat label="Winning ads" value={winnerCount} href="/winners" />
        <Stat label="Runs" value={runCount} href="/runs" />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent runs</h2>
            <Link href="/runs" className="text-xs text-ink-500 hover:text-ink-900">View all →</Link>
          </div>
          <div className="divider" />
          {recentRuns.length === 0 ? (
            <p className="text-sm text-ink-500">No runs yet. <Link href="/new" className="underline">Start one.</Link></p>
          ) : (
            <ul className="space-y-2">
              {recentRuns.map((r) => {
                const blocks = r.generations.filter((g) => g.complianceStatus === "block").length;
                const warns = r.generations.filter((g) => g.complianceStatus === "warn").length;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/runs/${r.id}`}
                      className="flex items-center justify-between rounded-md border border-ink-200 p-3 transition duration-150 hover:border-ink-300 hover:bg-ink-50"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {r.angle.name} · {r.brief.subAvatar?.name ?? "generic"}
                        </div>
                        <div className="text-xs text-ink-500">
                          {r.brief.lane} · {r.brief.funnel} · {r.generations.length}/{r.brief.targetCount} prompts
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`tag ${r.status === "complete" ? "tag-ok" : r.status === "failed" ? "tag-danger" : "tag-warn"}`}>{r.status}</span>
                        {blocks > 0 && <span className="tag tag-danger">{blocks} block</span>}
                        {warns > 0 && <span className="tag tag-warn">{warns} warn</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold">Kill criteria</h2>
          <div className="divider" />
          <ul className="space-y-3 text-sm">
            {principles.map((p) => (
              <li key={p.id}>
                <div className="font-medium">{p.title}</div>
                <p className="mt-0.5 text-xs text-ink-500">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="card card-interactive group">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight group-hover:text-ink-900">{value}</div>
    </Link>
  );
}
