import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase, unwrapOpt } from "@/lib/db";
import type { RunRow, AngleRow, BriefRow, SubAvatarRow, WinningAdRow, BigSwingRow, GenerationRow } from "@/lib/database.types";
import { RunDetail } from "./RunDetail";
import type { GateResult } from "@/lib/cellumove/compliance";

type RunFull = RunRow & {
  angle: AngleRow;
  brief: BriefRow & { subAvatar: SubAvatarRow | null; parentWinner: WinningAdRow | null; bigSwing: BigSwingRow | null };
  generations: GenerationRow[];
};

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runRes = await supabase
    .from("Run")
    .select(
      "*, angle:Angle(*), brief:Brief(*, subAvatar:SubAvatar(*), parentWinner:WinningAd(*), bigSwing:BigSwing(*)), generations:Generation(*)",
    )
    .eq("id", id)
    .maybeSingle();
  const run = unwrapOpt(runRes) as RunFull | null;
  if (!run) notFound();
  // generations sort: PostgREST nested order is not portable; sort here.
  run.generations.sort((a, b) => a.index - b.index);

  const gens = run.generations.map((g) => {
    let notes: GateResult[] = [];
    try { notes = JSON.parse(g.complianceNotes) as GateResult[]; } catch { /* corrupt JSON */ }
    return {
      id: g.id,
      index: g.index,
      tool: g.tool,
      level: g.level,
      hook: g.hook,
      headlineRendered: g.headlineRendered,
      promptText: g.promptText,
      complianceStatus: g.complianceStatus as "pass" | "warn" | "block" | "pending",
      complianceNotes: notes,
      verdict: g.verdict as "pending" | "approved" | "rejected" | "regenerate",
      verdictNote: g.verdictNote,
    };
  });

  return (
    <div className="space-y-5">
      <header>
        <Link href="/runs" className="text-xs text-ink-500 hover:text-ink-900">← All runs</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {run.angle.name} · {run.brief.subAvatar?.name ?? "generic"}
            </h1>
            <p className="text-sm text-ink-500">
              {run.brief.lane === "iterate"
                ? `Iterate ← ${run.brief.parentWinner?.adName ?? "—"} · ${run.brief.iterationVar ?? "—"}`
                : `Big Swing → ${run.brief.bigSwing?.name ?? "—"}${run.brief.hookMechanic ? ` · ${run.brief.hookMechanic}` : ""}`}
              {" · "} {run.brief.funnel} · started {new Date(run.startedAt).toLocaleString()}
            </p>
          </div>
          <span className={`tag ${run.status === "complete" ? "tag-ok" : run.status === "failed" ? "tag-danger" : "tag-warn"}`}>
            {run.status}
          </span>
        </div>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">Brief</h2>
        <div className="divider" />
        <dl className="grid-fields text-sm">
          <Field label="Hook" value={run.brief.hook} />
          <Field label="Exact headline" value={run.brief.exactHeadline} />
          <Field label="Visual concept" value={run.brief.visualConcept} wide />
          {run.brief.hypothesis && <Field label="Hypothesis" value={run.brief.hypothesis} wide />}
          {run.error && <Field label="Error" value={run.error} wide tone="danger" />}
        </dl>
      </section>

      <RunDetail runId={run.id} brief={{ angleSlug: run.angle.slug, parentAdName: run.brief.parentWinner?.adName ?? null }} generations={gens} />
    </div>
  );
}

function Field({ label, value, wide, tone }: { label: string; value: string; wide?: boolean; tone?: "danger" }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="label">{label}</dt>
      <dd className={`rounded-md border px-3 py-2 text-sm ${tone === "danger" ? "border-red-300 bg-red-50 text-red-800" : "border-ink-200 bg-ink-50"}`}>{value || "—"}</dd>
    </div>
  );
}
