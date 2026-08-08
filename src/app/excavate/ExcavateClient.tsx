"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { excavateAvatar, startDeepDiveFromExcavation, type ExcavationResult } from "../actions/excavate";
import { VerificationBadges } from "../research/DraftCards";

interface RecentExcavation {
  id: string;
  avatarName: string;
  subCount: number;
  createdAt: string;
}

export function ExcavateClient({
  initial,
  recent,
}: {
  initial: ExcavationResult | null;
  recent: RecentExcavation[];
}) {
  const router = useRouter();
  const [surfaceDesire, setSurfaceDesire] = useState(initial?.surfaceDesire ?? "");
  const [problem, setProblem] = useState(initial?.problem ?? "");
  const [result, setResult] = useState<ExcavationResult | null>(initial);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startingIdx, setStartingIdx] = useState<number | null>(null);

  // Elapsed-seconds ticker while excavating — the run is long (grounded research).
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (busy) {
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [busy]);

  const excavate = () => {
    if (!surfaceDesire.trim() && !problem.trim()) {
      setError("Enter at least a surface desire or a problem.");
      return;
    }
    setError(null);
    setResult(null);
    setBusy(true);
    (async () => {
      try {
        setResult(await excavateAvatar({ surfaceDesire, problem }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const deepDive = (index: number) => {
    if (!result) return;
    setError(null);
    setStartingIdx(index);
    (async () => {
      try {
        const { runId } = await startDeepDiveFromExcavation({ excavationId: result.id, index });
        router.push(`/pipeline/${runId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStartingIdx(null);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Avatar Excavation</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Step 1 of the pipeline. Give one <span className="font-medium text-ink-700">surface desire</span> and one{" "}
          <span className="font-medium text-ink-700">problem</span>. We scrape real verbatims across Reddit, YouTube,
          Quora &amp; reviews, then map the avatar — its name and every distinct sub-avatar. Pick one to deep-dive.
        </p>
      </header>

      {/* Seed inputs */}
      <section className="card">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="desire">Surface desire</label>
            <textarea
              id="desire"
              className="input min-h-[84px]"
              placeholder="e.g. 'I want my legs to look smooth and toned in leggings'"
              value={surfaceDesire}
              onChange={(e) => setSurfaceDesire(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label" htmlFor="problem">Problem they encounter</label>
            <textarea
              id="problem"
              className="input min-h-[84px]"
              placeholder="e.g. 'visible cellulite and heavy, aching legs by the end of the day'"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-primary" onClick={excavate} disabled={busy}>
            {busy ? "Excavating…" : result ? "Excavate again" : "Excavate avatar →"}
          </button>
          {busy && (
            <span className="inline-flex items-center gap-2 text-xs text-ink-500">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-300 border-t-ink-900" />
              Deep research + verbatim scrape · {elapsed}s
              <span className="text-ink-400">(usually 60–150s)</span>
            </span>
          )}
        </div>
        {busy && (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-ink-100" style={{ width: `${90 - i * 15}%` }} />
            ))}
          </div>
        )}
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      </section>

      {/* Results */}
      {result && (
        <section className="space-y-4">
          <div className="card border-brand-pink/40 bg-brand-pink/5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Avatar</div>
                <h2 className="text-xl font-semibold text-ink-900">{result.avatarName}</h2>
              </div>
              <span className="tag">Angle: {result.angle.name}</span>
            </div>
            {result.avatarSummary && <p className="mt-2 text-sm text-ink-600">{result.avatarSummary}</p>}
            <div className="mt-2 text-xs text-ink-500">
              <span className="font-medium text-ink-600">Mechanism:</span> {result.angle.mechanism}
              {result.angle.requiredKeyword && (
                <>
                  {" "}
                  · <span className="font-medium text-ink-600">Keyword:</span> {result.angle.requiredKeyword}
                </>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Sub-avatars <span className="text-ink-400">({result.subAvatars.length})</span>
              <span className="ml-2 text-xs font-normal text-ink-500">Pick one to deep-dive →</span>
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {result.subAvatars.map((s, i) => (
                <div key={i} className="card flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink-900">{s.name}</span>
                        <VerificationBadges v={s.verification} />
                      </div>
                      {s.shortDesc && <div className="mt-0.5 text-xs text-ink-500">{s.shortDesc}</div>}
                    </div>
                  </div>

                  {s.distinctFrom && (
                    <p className="mt-2 text-xs text-ink-500">
                      <span className="font-medium text-ink-600">Distinct:</span> {s.distinctFrom}
                    </p>
                  )}

                  <dl className="mt-2 space-y-1.5 text-xs">
                    {s.coreProblem && (
                      <div>
                        <dt className="font-medium text-ink-600">Core problem</dt>
                        <dd className="text-ink-500">{s.coreProblem}</dd>
                      </div>
                    )}
                    {s.painPoints && (
                      <div>
                        <dt className="font-medium text-ink-600">Pain (verbatim)</dt>
                        <dd className="whitespace-pre-wrap text-ink-500 line-clamp-4">{s.painPoints}</dd>
                      </div>
                    )}
                    {s.triggers && (
                      <div>
                        <dt className="font-medium text-ink-600">Triggers</dt>
                        <dd className="whitespace-pre-wrap text-ink-500 line-clamp-3">{s.triggers}</dd>
                      </div>
                    )}
                  </dl>

                  {s.sources.length > 0 && (
                    <div className="mt-2 text-[11px] text-ink-400">
                      {s.sources.length} source{s.sources.length === 1 ? "" : "s"} cited
                    </div>
                  )}

                  <div className="mt-auto pt-3">
                    <button
                      className="btn btn-primary w-full text-xs"
                      onClick={() => deepDive(i)}
                      disabled={startingIdx !== null}
                    >
                      {startingIdx === i ? "Starting deep dive…" : "Deep dive this sub-avatar →"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent excavations */}
      {recent.length > 0 && (
        <section className="card">
          <h3 className="text-sm font-semibold">Recent excavations</h3>
          <div className="divider" />
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/excavate?id=${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-white p-3 transition hover:border-ink-900 hover:bg-ink-50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{r.avatarName}</div>
                    <div className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleString()}</div>
                  </div>
                  <span className="tag">{r.subCount} sub-avatars</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
