"use client";

import { useState } from "react";
import {
  saveResearchedAngle,
  saveResearchedSubAvatar,
  type ResearchedAngleDraft,
  type ResearchedAvatarDraft,
  type ResearchedConceptDraft,
} from "../actions/research";
import { submitResearchFeedback } from "../actions/research-feedback";
import type { DraftVerification } from "@/lib/cellumove/verify-research";
import type { ResearchEvidenceClaim, ResearchQualityReport } from "@/lib/cellumove/research-evidence";

// Shared draft card components used by both the ResearchClient (live drafts
// from the current session) and the detail page (drafts pulled from a past
// Research row).

export function AngleDraftCard({ draft }: { draft: ResearchedAngleDraft }) {
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (overrideQuality = false) => {
    setError(null);
    setIsSaving(true);
    (async () => {
      try {
        await saveResearchedAngle(draft, overrideQuality);
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
        <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-ink-900">{draft.name}</span><QualityBadge quality={draft.quality} /></div>
        {saved ? (
          <span className="tag tag-ok">saved</span>
        ) : (
          <button className="btn btn-ghost text-xs" onClick={() => save(false)} disabled={isSaving}>
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
      <ResearchEvidencePanel evidence={draft.evidence} verification={draft.verification} />
      <ResearchFeedbackControls researchId={draft.researchId} draftKey={draft.draftKey} />
      {draft.quality?.status === "reject" && !saved && (
        <button className="mt-2 text-xs text-amber-800 underline" onClick={() => save(true)} disabled={isSaving}>Save anyway with quality override</button>
      )}
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}

export function SubAvatarDraftCard({ draft, angleSlug }: { draft: ResearchedAvatarDraft; angleSlug: string }) {
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (overrideQuality = false) => {
    setError(null);
    setIsSaving(true);
    (async () => {
      try {
        await saveResearchedSubAvatar({ angleSlug, draft, overrideQuality });
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
          <QualityBadge quality={draft.quality} />
        </div>
        {saved ? (
          <span className="tag tag-ok">saved</span>
        ) : (
          <button className="btn btn-ghost text-xs" onClick={() => save(false)} disabled={isSaving}>
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
          <ResearchEvidencePanel evidence={draft.evidence} verification={draft.verification} />
        </div>
      </details>
      <ResearchFeedbackControls researchId={draft.researchId} draftKey={draft.draftKey} />
      {draft.quality?.status === "reject" && !saved && (
        <button className="mt-2 text-xs text-amber-800 underline" onClick={() => save(true)} disabled={isSaving}>Save anyway with quality override</button>
      )}
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
      <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-ink-900">{draft.title}</span><QualityBadge quality={draft.quality} /></div>
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
      <ResearchEvidencePanel evidence={draft.evidence} verification={draft.verification} />
      <ResearchFeedbackControls researchId={draft.researchId} draftKey={draft.draftKey} />
    </div>
  );
}

function QualityBadge({ quality }: { quality?: ResearchQualityReport }) {
  if (!quality) return null;
  const cls = quality.status === "pass" ? "tag tag-ok" : quality.status === "review" ? "tag tag-warn" : "tag tag-danger";
  return <span className={cls} title={[...quality.blockers, ...quality.warnings].join(" ")}>evidence {quality.score}/100 · {quality.status}</span>;
}

function ResearchEvidencePanel({ evidence, verification }: { evidence?: ResearchEvidenceClaim[]; verification?: DraftVerification | null }) {
  const items = evidence ?? verification?.evidence ?? [];
  if (items.length === 0) return null;
  return (
    <details className="mt-2 rounded-md border border-ink-200 bg-white p-2">
      <summary className="cursor-pointer font-medium text-ink-700">Evidence ledger · {items.length} items</summary>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => {
          const status = item.verificationStatus ?? "unverified";
          const statusClass = status === "verified" || status === "source_checked" ? "text-emerald-700" : status === "inference" ? "text-blue-700" : "text-amber-700";
          return (
            <li key={`${item.category}-${index}`} className="border-l-2 border-ink-200 pl-2">
              <div className="flex flex-wrap gap-1"><span className="tag">{item.category}</span><span className="tag">{item.type}</span><span className={statusClass}>{status.replace("_", " ")}</span></div>
              <div className="mt-0.5 text-ink-700">{item.type === "verbatim" ? `“${item.text}”` : item.text}</div>
              {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-ink-500 underline">source</a>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ResearchFeedbackControls({ researchId, draftKey }: { researchId?: string; draftKey?: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!researchId || !draftKey) return null;
  const send = async (rating: string) => {
    setPending(true);
    setError(null);
    try {
      await submitResearchFeedback({ researchId, draftKey, rating });
      setSent(rating);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-2 border-t border-ink-200 pt-2">
      <div className="text-[11px] font-medium text-ink-500">Strategist feedback</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {[
          ["useful", "Useful"],
          ["generic", "Too generic"],
          ["incorrect", "Incorrect"],
          ["duplicate", "Duplicate"],
          ["used_in_script", "Used in script"],
        ].map(([rating, label]) => (
          <button key={rating} className={`btn btn-ghost text-[11px] ${sent === rating ? "border-emerald-500 text-emerald-700" : ""}`} disabled={pending} onClick={() => send(rating!)}>{label}</button>
        ))}
      </div>
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}
