"use client";

import { useState } from "react";
import { candidateCounts, type ImageAdCandidate } from "@/lib/cellumove/image-ad-concepts";
import {
  IMAGE_AD_REFERENCE_ROLES,
  imageAdReferencesReady,
  type ImageAdReferenceOption,
  type ImageAdReferenceSnapshot,
} from "@/lib/cellumove/image-ad-references";
import { Lightbox, Steps, type StepState } from "../ui";
import { CandidateGallery } from "./CandidateGallery";
import { ReferenceAdPicker } from "./ReferenceAdPicker";

function analysisSummary(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { summary?: unknown };
    return typeof parsed.summary === "string" ? parsed.summary : "";
  } catch {
    return "";
  }
}

const roleLabel = (value: string) => IMAGE_AD_REFERENCE_ROLES.find((role) => role.value === value)?.label ?? value;

export function BatchWorkspace({
  batchId,
  avatarName,
  angleName,
  targetCount,
  format,
  costPerImage,
  secondsPerImage,
  options,
  initialReferences,
  initialCandidates,
}: {
  batchId: string;
  avatarName: string;
  angleName: string;
  targetCount: number;
  format: string;
  costPerImage: number;
  secondsPerImage: number;
  options: ImageAdReferenceOption[];
  initialReferences: ImageAdReferenceSnapshot[];
  initialCandidates: ImageAdCandidate[];
}) {
  const [references, setReferences] = useState(initialReferences);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<ImageAdReferenceSnapshot | null>(null);

  const referencesReady = imageAdReferencesReady(references);
  const counts = candidateCounts(candidates);
  const planned = candidates.length > 0;
  const complete = planned && counts.ready === candidates.length;
  // Concepts cite references by id, so the set freezes the moment they exist.
  const locked = planned;
  const showPicker = !referencesReady || (editing && !locked);

  const state = (done: boolean, available: boolean): StepState => done ? "done" : available ? "current" : "locked";
  const steps = [
    {
      label: "Choose references",
      detail: referencesReady ? `${references.length} winning ads saved` : "3–5 winning ads, 2+ competitors",
      state: state(referencesReady, true),
    },
    {
      label: "Plan concepts",
      detail: planned ? `${candidates.length} concepts written` : `${targetCount} headlines and visual briefs`,
      state: state(planned, referencesReady),
    },
    {
      label: "Generate images",
      detail: planned ? `${counts.ready} of ${candidates.length} ready` : "Rendered one by one",
      state: state(complete, planned),
    },
  ];

  return (
    <div className="space-y-4">
      <Steps steps={steps} />

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">1 · References</h2>
            <p className="text-xs text-ink-500">
              {showPicker
                ? "Pick competitor ads that are already winning, and say what each one should inspire."
                : "These guide the concepts. Each image is archived, so it stays available after BrandSearch expires it."}
            </p>
          </div>
          {!showPicker && (
            locked
              ? <span className="tag" title="Concepts were written from these references. Start a new batch to use a different set.">Locked</span>
              : <button type="button" className="btn text-xs" onClick={() => setEditing(true)}>Edit references</button>
          )}
        </div>

        {showPicker ? (
          <ReferenceAdPicker
            batchId={batchId}
            avatarName={avatarName}
            angleName={angleName}
            options={options}
            savedReferences={references}
            onSaved={(saved) => { setReferences(saved); setEditing(false); }}
            onCancel={referencesReady ? () => setEditing(false) : undefined}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {references.map((reference) => (
              <li key={reference.adId}>
                <button
                  type="button"
                  onClick={() => setViewing(reference)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-200 bg-white p-2 text-left transition hover:border-ink-400"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reference.archivedImageUrl} alt="" className="h-16 w-[3.25rem] shrink-0 rounded-lg object-cover" loading="lazy" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ink-900">{reference.brandName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {reference.roles.map((role) => (
                        <span key={role} className="rounded-full bg-brand-pink/20 px-1.5 py-0.5 text-[10px] text-brand-plum">
                          {roleLabel(role)}
                        </span>
                      ))}
                    </div>
                    {reference.width && reference.height && (
                      <div className="mt-1 text-[10px] text-ink-400">{reference.width}×{reference.height}px</div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`card ${referencesReady ? "" : "opacity-60"}`}>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-ink-900">2 · Concepts and images</h2>
          {!referencesReady && <p className="text-xs text-ink-500">Save your references first — concepts are written from them.</p>}
        </div>
        {referencesReady && (
          <CandidateGallery
            batchId={batchId}
            targetCount={targetCount}
            format={format}
            costPerImage={costPerImage}
            secondsPerImage={secondsPerImage}
            references={references}
            candidates={candidates}
            onCandidatesChange={(update) => setCandidates(update)}
          />
        )}
      </section>

      {viewing && (
        <Lightbox src={viewing.archivedImageUrl} alt={`${viewing.brandName} reference`} onClose={() => setViewing(null)}>
          <div>
            <div className="label">Inspires</div>
            <p>{viewing.roles.map(roleLabel).join(", ")}</p>
          </div>
          {analysisSummary(viewing.analysis) && (
            <div>
              <div className="label">What we took from it</div>
              <p>{analysisSummary(viewing.analysis)}</p>
            </div>
          )}
          {viewing.copy && (
            <div>
              <div className="label">Original copy</div>
              <p>{viewing.copy}</p>
            </div>
          )}
          {viewing.sourceUrl && (
            <a className="underline" href={viewing.sourceUrl} target="_blank" rel="noopener noreferrer">Open source ad ↗</a>
          )}
        </Lightbox>
      )}
    </div>
  );
}
