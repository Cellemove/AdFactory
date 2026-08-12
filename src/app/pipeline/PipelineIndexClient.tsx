"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPipelineRun } from "../actions/pipeline-run";
import {
  researchSubAvatars,
  saveResearchedSubAvatar,
  type ResearchedAvatarDraft,
} from "../actions/research";
import { VerificationBadges } from "../research/DraftCards";

interface SubOption {
  id: string;
  name: string;
  shortDesc: string | null;
  angleName: string;
}
interface AngleOption {
  slug: string;
  name: string;
}
interface RunSummary {
  id: string;
  avatarName: string | null;
  angleSlug: string | null;
  createdAt: string;
  done: number;
  total: number;
}

export function PipelineIndexClient({
  subOptions,
  runs,
  angles,
  excavateSlot,
}: {
  subOptions: SubOption[];
  runs: RunSummary[];
  angles: AngleOption[];
  excavateSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [subAvatarId, setSubAvatarId] = useState(subOptions[0]?.id ?? "");
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Research a brand-new avatar inline ──────────────────────────────────────
  const [rAngle, setRAngle] = useState(angles[0]?.slug ?? "");
  const [rFocus, setRFocus] = useState("");
  const [rDrafts, setRDrafts] = useState<ResearchedAvatarDraft[] | null>(null);
  const [rResearching, setRResearching] = useState(false);
  const [rError, setRError] = useState<string | null>(null);
  const [startingIdx, setStartingIdx] = useState<number | null>(null);

  const start = () => {
    if (!subAvatarId) return;
    setError(null);
    startTransition(async () => {
      try {
        const { runId } = await createPipelineRun(subAvatarId);
        // ?auto=1 tells the stepper to run every stage on load — fully hands-off.
        router.push(`/pipeline/${runId}${auto ? "?auto=1" : ""}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const runResearch = () => {
    if (!rAngle) return;
    setRError(null);
    setRDrafts(null);
    setRResearching(true);
    (async () => {
      try {
        setRDrafts(await researchSubAvatars(rAngle, rFocus || null));
      } catch (e) {
        setRError(e instanceof Error ? e.message : String(e));
      } finally {
        setRResearching(false);
      }
    })();
  };

  // Save the chosen draft as a new avatar AND immediately start a pipeline on it.
  const startWithDraft = (draft: ResearchedAvatarDraft, idx: number) => {
    setRError(null);
    setStartingIdx(idx);
    (async () => {
      try {
        const { subAvatarId: newId } = await saveResearchedSubAvatar({ angleSlug: rAngle, draft });
        const { runId } = await createPipelineRun(newId);
        router.push(`/pipeline/${runId}${auto ? "?auto=1" : ""}`);
      } catch (e) {
        setRError(e instanceof Error ? e.message : String(e));
        setStartingIdx(null);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-ink-500">
          The full G1→G7 build for one avatar: Excavation → Deep Dive → Root Cause &amp; Mechanism →
          Brand DNA → Copy Arsenal → Advertorial → Ad Scripts → Creative Briefs. Each stage runs on
          demand and feeds the next.
        </p>
      </header>

      {/* Step 1 — Avatar Excavation is the front door: desire + problem → avatar + sub-avatars. */}
      {excavateSlot}

      <section className="card">
        <h2 className="text-sm font-semibold">Start a new pipeline</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Pick an avatar whose Excavation (G1) and Deep Dive (G2) are already done — those are the
          first two steps, reused as-is.
        </p>
        {subOptions.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
            No researched avatars yet. Run sub-avatar research under{" "}
            <Link href="/research" className="underline hover:text-ink-900">
              /research
            </Link>{" "}
            first.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="input flex-1"
              value={subAvatarId}
              onChange={(e) => setSubAvatarId(e.target.value)}
              disabled={isPending}
            >
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.angleName}
                </option>
              ))}
            </select>
            <button className="btn btn-primary sm:w-48" onClick={start} disabled={isPending || !subAvatarId}>
              {isPending ? "Starting…" : auto ? "Start + run all →" : "Start pipeline →"}
            </button>
          </div>
        )}
        {subOptions.length > 0 && (
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={isPending} />
            Run all stages automatically (G3→G7) — no clicking through each one
          </label>
        )}
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      </section>

      {/* Research a brand-new avatar, then start a pipeline on it — no detour. */}
      <section className="card">
        <h2 className="text-sm font-semibold">Or research a new avatar</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Mine fresh candidates from the web for an angle. Pick one and its pipeline starts on the spot
          — it&apos;s also saved to{" "}
          <Link href="/avatars" className="underline hover:text-ink-900">/avatars</Link> for reuse.
        </p>
        {angles.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
            No angles yet. Create one under{" "}
            <Link href="/research" className="underline hover:text-ink-900">/research</Link> first.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                className="input sm:w-64"
                value={rAngle}
                onChange={(e) => setRAngle(e.target.value)}
                disabled={rResearching || startingIdx !== null}
              >
                {angles.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input
                className="input flex-1"
                placeholder="Focus (optional) — e.g. 'post-pregnancy 30-40'"
                value={rFocus}
                onChange={(e) => setRFocus(e.target.value)}
                disabled={rResearching || startingIdx !== null}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !rResearching) runResearch();
                }}
              />
              <button
                className="btn btn-primary sm:w-48"
                onClick={runResearch}
                disabled={rResearching || startingIdx !== null || !rAngle}
              >
                {rResearching ? "Researching… (30–60s)" : rDrafts ? "Research again" : "Research candidates"}
              </button>
            </div>
            {rError && <div className="mt-2 text-xs text-red-700">{rError}</div>}
            {rResearching && (
              <p className="mt-2 text-xs text-ink-500">
                Gemini is searching Reddit/Quora/forums and synthesizing candidate avatars…
              </p>
            )}
            {rDrafts && rDrafts.length > 0 && (
              <ul className="mt-3 space-y-2">
                {rDrafts.map((d, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-ink-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink-900">{d.name}</span>
                          <VerificationBadges v={d.verification} />
                        </div>
                        {d.shortDesc && <div className="mt-0.5 text-xs text-ink-500">{d.shortDesc}</div>}
                        {d.painPoints && (
                          <div className="mt-1 line-clamp-2 text-xs text-ink-600">{d.painPoints}</div>
                        )}
                      </div>
                      <button
                        className="btn btn-primary shrink-0 text-xs"
                        onClick={() => startWithDraft(d, i)}
                        disabled={startingIdx !== null}
                      >
                        {startingIdx === i ? "Starting…" : auto ? "Save + run all →" : "Start pipeline →"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {rDrafts && rDrafts.length === 0 && !rResearching && (
              <p className="mt-3 text-sm text-ink-500">No candidates came back — try a focus and re-run.</p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Recent pipelines</h2>
        <div className="divider" />
        {runs.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing yet. Start one above.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/pipeline/${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-white p-3 transition hover:border-ink-900 hover:bg-ink-50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{r.avatarName || "Pipeline run"}</div>
                    <div className="text-xs text-ink-500">
                      {r.angleSlug ? `${r.angleSlug} · ` : ""}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="tag">
                    {r.done}/{r.total} stages
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
