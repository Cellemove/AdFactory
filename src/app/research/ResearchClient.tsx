"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  researchAngles,
  researchSubAvatars,
  researchConcepts,
  type ResearchedAngleDraft,
  type ResearchedAvatarDraft,
  type ResearchedConceptDraft,
} from "../actions/research";
import { AngleDraftCard, SubAvatarDraftCard, ConceptDraftCard } from "./DraftCards";

interface AngleLite { slug: string; name: string }
interface RecentResearch {
  id: string;
  type: string;
  angleSlug: string | null;
  focus: string | null;
  drafts: string;
  status: string;
  createdAt: string;
}

type ResearchType = "angle" | "sub_avatar" | "concept";

// Live elapsed timer — ticks while `active` is true, resets to 0 when it flips
// back to false. Uses Date.now() under the hood so it stays accurate even if
// the tab is backgrounded and the interval drifts.
function useElapsedMs(active: boolean): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      setMs(0);
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    setMs(0);
    const id = setInterval(() => {
      if (startRef.current != null) setMs(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [active]);
  return ms;
}

function formatElapsed(ms: number): string {
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ResearchClient({ angles, recent }: { angles: AngleLite[]; recent: RecentResearch[] }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AngleSection />
        <SubAvatarSection angles={angles} />
        <ConceptSection angles={angles} />
      </div>

      <section className="card">
        <h2 className="text-sm font-semibold">Recent research</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          The last 30 research sessions across all three types.
        </p>
        <div className="divider" />
        {recent.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing yet. Run a research session above to see it here.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => (
              <RecentItem key={r.id} item={r} angles={angles} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Angle research section ─────────────────────────────────────────────────
function AngleSection() {
  const [focus, setFocus] = useState("");
  const [drafts, setDrafts] = useState<ResearchedAngleDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [, startTransition] = useTransition();
  const elapsed = useElapsedMs(isRunning);

  const run = () => {
    setError(null);
    setIsRunning(true);
    setDrafts(null);
    startTransition(async () => {
      try {
        const d = await researchAngles(focus || null);
        setDrafts(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    });
  };

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">Angles</h2>
      <p className="mt-0.5 text-xs text-ink-500">
        Prospect new strategic positionings for the brand.
      </p>
      <div className="mt-3 space-y-2">
        <input
          className="input"
          placeholder="Focus (optional) — e.g. 'sleep + recovery'"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          disabled={isRunning}
        />
        <button className="btn btn-primary w-full" onClick={run} disabled={isRunning}>
          {isRunning ? `Researching… ${formatElapsed(elapsed)} / ~30-60s` : "Start angle research"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      {drafts && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-500">{drafts.length} candidate angles. Save the ones worth keeping.</p>
          {drafts.map((d, i) => (
            <AngleDraftCard key={i} draft={d} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Sub-avatar research section ────────────────────────────────────────────
function SubAvatarSection({ angles }: { angles: AngleLite[] }) {
  const [angleSlug, setAngleSlug] = useState(angles[0]?.slug ?? "");
  const [focus, setFocus] = useState("");
  const [drafts, setDrafts] = useState<ResearchedAvatarDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [, startTransition] = useTransition();
  const elapsed = useElapsedMs(isRunning);

  const run = () => {
    if (!angleSlug) return;
    setError(null);
    setIsRunning(true);
    setDrafts(null);
    startTransition(async () => {
      try {
        const d = await researchSubAvatars(angleSlug, focus || null);
        setDrafts(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    });
  };

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">Sub-avatars</h2>
      <p className="mt-0.5 text-xs text-ink-500">
        Find candidate audiences inside an angle, with research already attached.
      </p>
      <div className="mt-3 space-y-2">
        <select className="input" value={angleSlug} onChange={(e) => setAngleSlug(e.target.value)} disabled={isRunning}>
          {angles.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>
        <input
          className="input"
          placeholder="Focus (optional) — e.g. 'post-pregnancy 30-40'"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          disabled={isRunning}
        />
        <button className="btn btn-primary w-full" onClick={run} disabled={isRunning || !angleSlug}>
          {isRunning ? `Researching… ${formatElapsed(elapsed)} / ~30-60s` : "Start sub-avatar research"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      {drafts && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-500">{drafts.length} candidate sub-avatars.</p>
          {drafts.map((d, i) => (
            <SubAvatarDraftCard key={i} draft={d} angleSlug={angleSlug} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Concept research section ──────────────────────────────────────────────
function ConceptSection({ angles }: { angles: AngleLite[] }) {
  const [angleSlug, setAngleSlug] = useState(angles[0]?.slug ?? "");
  const [focus, setFocus] = useState("");
  const [drafts, setDrafts] = useState<ResearchedConceptDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [, startTransition] = useTransition();
  const elapsed = useElapsedMs(isRunning);

  const run = () => {
    if (!angleSlug) return;
    setError(null);
    setIsRunning(true);
    setDrafts(null);
    startTransition(async () => {
      try {
        const d = await researchConcepts(angleSlug, focus || null);
        setDrafts(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    });
  };

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">Concepts</h2>
      <p className="mt-0.5 text-xs text-ink-500">
        Find specific ad concepts (hook + headline + visual) currently winning.
      </p>
      <div className="mt-3 space-y-2">
        <select className="input" value={angleSlug} onChange={(e) => setAngleSlug(e.target.value)} disabled={isRunning}>
          {angles.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>
        <input
          className="input"
          placeholder="Focus (optional) — e.g. 'beach season hooks'"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          disabled={isRunning}
        />
        <button className="btn btn-primary w-full" onClick={run} disabled={isRunning || !angleSlug}>
          {isRunning ? `Researching… ${formatElapsed(elapsed)} / ~30-60s` : "Start concept research"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      {drafts && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-500">{drafts.length} candidate concepts.</p>
          {drafts.map((d, i) => <ConceptDraftCard key={i} draft={d} />)}
        </div>
      )}
    </section>
  );
}

// ─── Recent research list ──────────────────────────────────────────────────
function RecentItem({ item, angles }: { item: RecentResearch; angles: AngleLite[] }) {
  const angle = angles.find((a) => a.slug === item.angleSlug);
  let draftCount = 0;
  try {
    const parsed = JSON.parse(item.drafts);
    if (Array.isArray(parsed)) draftCount = parsed.length;
  } catch { /* ignore */ }
  const typeLabel: Record<string, string> = {
    angle: "Angles",
    sub_avatar: "Sub-avatars",
    concept: "Concepts",
  };
  const when = new Date(item.createdAt).toLocaleString();
  return (
    <li>
      <Link
        href={`/research/${item.id}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-white p-3 transition hover:border-ink-900 hover:bg-ink-50"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">
            <span className="tag">{typeLabel[item.type] ?? item.type}</span>
            {angle && <span className="ml-2">{angle.name}</span>}
            {!angle && item.type === "angle" && <span className="ml-2 text-ink-500">(no angle)</span>}
          </div>
          <div className="text-xs text-ink-500">
            {draftCount} drafts · {when}{item.focus ? ` · focus: "${item.focus}"` : ""}
          </div>
        </div>
        <span className="text-xs text-ink-500">open →</span>
      </Link>
    </li>
  );
}

// Re-export types so the file can be standalone-readable.
export type { ResearchType };
