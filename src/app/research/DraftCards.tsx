"use client";

import { useState } from "react";
import {
  saveResearchedAngle,
  saveResearchedSubAvatar,
  type ResearchedAngleDraft,
  type ResearchedAvatarDraft,
  type ResearchedConceptDraft,
} from "../actions/research";
import type { DraftVerification } from "@/lib/cellumove/verify-research";

// Shared draft card components used by both the ResearchClient (live drafts
// from the current session) and the detail page (drafts pulled from a past
// Research row).

export function AngleDraftCard({ draft }: { draft: ResearchedAngleDraft }) {
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    setIsSaving(true);
    (async () => {
      try {
        await saveResearchedAngle(draft);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSaving(false);
      }
    })();
  };
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-ink-900">{draft.name}</div>
        {saved ? (
          <span className="tag tag-ok">saved</span>
        ) : (
          <button className="btn btn-ghost text-xs" onClick={save} disabled={isSaving}>
            {isSaving ? "saving…" : "save as angle"}
          </button>
        )}
      </div>
      <div className="mt-1 text-ink-600">{draft.positioning}</div>
      <div className="mt-1 text-ink-500">
        <span className="font-medium">Mechanism:</span> {draft.mechanism}
      </div>
      <div className="mt-0.5 text-ink-500">
        <span className="font-medium">Audience:</span> {draft.audienceNote}
      </div>
      {draft.sources?.length > 0 && (
        <div className="mt-1 text-ink-500">
          <span className="font-medium">Sources:</span>{" "}
          {draft.sources.slice(0, 3).map((s, i) => (
            <a key={i} href={s} target="_blank" rel="noreferrer" className="underline hover:text-ink-900">[{i + 1}]</a>
          )).reduce<React.ReactNode[]>((acc, el, i) => acc.length === 0 ? [el] : [...acc, " ", el], [])}
        </div>
      )}
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}

export function SubAvatarDraftCard({ draft, angleSlug }: { draft: ResearchedAvatarDraft; angleSlug: string }) {
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    setIsSaving(true);
    (async () => {
      try {
        await saveResearchedSubAvatar({ angleSlug, draft });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSaving(false);
      }
    })();
  };
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-ink-900">{draft.name}</span>
          {draft.profile && Object.keys(draft.profile).length > 0 && (
            <span className="tag tag-ok" title={`Structured deep dive: ${Object.keys(draft.profile).length} sections`}>
              deep profile · {Object.keys(draft.profile).length}
            </span>
          )}
          <VerificationBadges v={draft.verification} />
        </div>
        {saved ? (
          <span className="tag tag-ok">saved</span>
        ) : (
          <button className="btn btn-ghost text-xs" onClick={save} disabled={isSaving}>
            {isSaving ? "saving…" : "save as sub-avatar"}
          </button>
        )}
      </div>
      <div className="mt-1 text-ink-600">{draft.shortDesc}</div>
      <details className="mt-1">
        <summary className="cursor-pointer text-ink-500">research details</summary>
        <div className="mt-1 space-y-1 text-ink-600">
          <div><span className="font-medium">Pain:</span> {draft.painPoints}</div>
          <div><span className="font-medium">Desires:</span> {draft.desires}</div>
          <div><span className="font-medium">Objections:</span> {draft.objections}</div>
          <div><span className="font-medium">Daily language:</span> {draft.dailyLanguage}</div>
          <div><span className="font-medium">Triggers:</span> {draft.triggers}</div>
          <div><span className="font-medium">Identity:</span> {draft.identity}</div>
          <div><span className="font-medium">Social proof:</span> {draft.socialProof}</div>
          <div><span className="font-medium">Buying context:</span> {draft.buyingContext}</div>
          {draft.sources?.length > 0 && (
            <div>
              <span className="font-medium">Sources:</span>{" "}
              {draft.sources.map((s, i) => {
                const check = draft.verification?.sources.find((c) => c.url === s);
                const mark = check ? (check.ok ? "✓" : "✗") : "";
                return (
                  <a
                    key={i}
                    href={s}
                    target="_blank"
                    rel="noreferrer"
                    title={check ? (check.ok ? `live (HTTP ${check.status})` : `dead/blocked (HTTP ${check.status || "?"})`) : s}
                    className={`mr-1 underline hover:text-ink-900 ${check && !check.ok ? "text-red-600" : ""}`}
                  >
                    [{i + 1}]{mark && <span className="ml-0.5">{mark}</span>}
                  </a>
                );
              })}
            </div>
          )}
          <VerificationDetails v={draft.verification} />
        </div>
      </details>
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}

// ─── Verification (anti-hallucination) UI ─────────────────────────────────────
export function VerificationBadges({ v }: { v?: DraftVerification | null }) {
  if (!v) return null;
  const srcClass = v.sourcesTotal === 0 ? "tag" : v.sourcesOk === v.sourcesTotal ? "tag tag-ok" : v.sourcesOk === 0 ? "tag tag-danger" : "tag tag-warn";
  const vbClass = v.verbatimsTotal === 0 ? "tag" : v.verbatimsVerified === v.verbatimsTotal ? "tag tag-ok" : v.verbatimsVerified === 0 ? "tag tag-danger" : "tag tag-warn";
  return (
    <>
      <span className={srcClass} title="Cited source URLs that actually load">
        sources {v.sourcesOk}/{v.sourcesTotal}
      </span>
      {v.verbatimsTotal > 0 && (
        <span className={vbClass} title="Quotes found verbatim in the cited pages">
          verbatims {v.verbatimsVerified}/{v.verbatimsTotal}
        </span>
      )}
    </>
  );
}

function VerificationDetails({ v }: { v?: DraftVerification | null }) {
  if (!v || v.verbatimsTotal === 0) return null;
  const unverified = v.verbatims.filter((x) => !x.verified);
  if (unverified.length === 0) {
    return <div className="text-emerald-700">All {v.verbatimsTotal} quoted verbatims were found in the cited sources ✓</div>;
  }
  return (
    <details>
      <summary className="cursor-pointer text-amber-700">
        {unverified.length} unverified quote{unverified.length === 1 ? "" : "s"} — not found in any cited source
      </summary>
      <ul className="mt-1 space-y-1">
        {unverified.map((x, i) => (
          <li key={i} className="text-amber-800">
            <span className="font-medium">[{x.category}]</span> &ldquo;{x.text}&rdquo;
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ConceptDraftCard({ draft }: { draft: ResearchedConceptDraft }) {
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5 text-xs">
      <div className="font-semibold text-ink-900">{draft.title}</div>
      <div className="mt-1 text-ink-700"><span className="font-medium">Hook:</span> {draft.hook}</div>
      <div className="mt-0.5 text-ink-700"><span className="font-medium">Headline:</span> {draft.headline}</div>
      <div className="mt-0.5 text-ink-600"><span className="font-medium">Visual:</span> {draft.visualConcept}</div>
      <div className="mt-1 text-ink-500 italic">{draft.reasoning}</div>
      {draft.sources?.length > 0 && (
        <div className="mt-1 text-ink-500">
          <span className="font-medium">Sources:</span>{" "}
          {draft.sources.map((s, i) => (
            <a key={i} href={s} target="_blank" rel="noreferrer" className="underline hover:text-ink-900 mr-1">[{i + 1}]</a>
          ))}
        </div>
      )}
    </div>
  );
}
