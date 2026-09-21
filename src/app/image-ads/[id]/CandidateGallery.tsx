"use client";

import { useRef, useState } from "react";
import { brandImageAdCandidate, generateImageAdCandidate, planImageAdConcepts } from "@/app/actions/image-ads";
import {
  candidateCounts,
  canApplyImageAdLogo,
  IMAGE_AD_LOGO_LAYOUT_VERSION,
  duplicateHeadlineSlots,
  type ImageAdCandidate,
} from "@/lib/cellumove/image-ad-concepts";
import {
  IMAGE_AD_REFERENCE_ROLES,
  type ImageAdReferenceSnapshot,
} from "@/lib/cellumove/image-ad-references";
import { Lightbox, aspectClass, formatDuration, useElapsed } from "../ui";

type Filter = "all" | "ready" | "todo" | "failed";

export function CandidateGallery({
  batchId,
  targetCount,
  format,
  costPerImage,
  secondsPerImage,
  references,
  candidates,
  onCandidatesChange,
}: {
  batchId: string;
  targetCount: number;
  format: string;
  costPerImage: number;
  secondsPerImage: number;
  references: ImageAdReferenceSnapshot[];
  candidates: ImageAdCandidate[];
  onCandidatesChange: (update: (current: ImageAdCandidate[]) => ImageAdCandidate[]) => void;
}) {
  const [planning, setPlanning] = useState(false);
  const [branding, setBranding] = useState(false);
  const [running, setRunning] = useState(false);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [queueDone, setQueueDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const planElapsed = useElapsed(planning);
  const runElapsed = useElapsed(running);

  const counts = candidateCounts(candidates);
  const duplicates = new Set(duplicateHeadlineSlots(candidates));
  const referenceInformed = candidates.filter((c) => c.concept.source === "reference_informed").length;
  const flagged = candidates.filter((c) => c.claimStatus === "flagged").length;
  const todoSlots = candidates.filter((c) => c.status !== "ready").map((c) => c.slot);
  const failedSlots = candidates.filter((c) => c.status === "failed").map((c) => c.slot);
  const unbrandedSlots = candidates.filter(canApplyImageAdLogo).map((c) => c.slot);
  const needsLogoRegeneration = candidates.some((c) => c.status === "ready" && c.imageUrl && c.logoAppliedAt && c.logoLayoutVersion !== IMAGE_AD_LOGO_LAYOUT_VERSION && !c.unbrandedImageUrl);
  const busy = planning || running || branding;
  const open = openSlot === null ? null : candidates.find((c) => c.slot === openSlot) ?? null;

  const visible = candidates.filter((candidate) =>
    filter === "all" ? true
      : filter === "ready" ? candidate.status === "ready"
      : filter === "failed" ? candidate.status === "failed"
      : candidate.status !== "ready");

  const plan = async () => {
    setError(null);
    setNotice(null);
    setPlanning(true);
    try {
      const result = await planImageAdConcepts(batchId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCandidatesChange(() => result.candidates);
      setFilter("all");
      setNotice(result.usedPipelineRunId
        ? "Concepts are grounded in this avatar's saved Pipeline research."
        : "No saved Pipeline research for this avatar, so concepts were planned from the avatar research alone.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPlanning(false);
    }
  };

  const addLogos = async () => {
    if (busy) return;
    setBranding(true);
    setError(null);
    setNotice(null);
    try {
      for (let i = 0; i < unbrandedSlots.length; i += 1) {
        setNotice(`Adding logo ${i + 1} of ${unbrandedSlots.length}...`);
        const slot = unbrandedSlots[i]!;
        const result = await brandImageAdCandidate(batchId, slot);
        if (!result.ok) {
          setError(result.error);
          setNotice(null);
          return;
        }
        onCandidatesChange((current) => current.map((item) => item.slot === slot ? result.candidate : item));
      }
      setNotice("Cellumove logos added. No image-generation charge. Open the images to review their placement.");
    } catch {
      setNotice(null);
      setError("Could not reach the server. Logos already applied are saved; try again to finish the rest.");
    } finally {
      setBranding(false);
    }
  };

  // Sequential on purpose: Next.js serializes server actions from one client, so
  // parallel calls would queue anyway, and one slot at a time keeps the progress
  // readout honest and the stop button responsive.
  //
  // A failed slot never stops the run. Failures get one automatic second pass at
  // the end; only three failures in a row — the signature of an outage, not of a
  // bad concept — halt it early so an outage cannot burn through the whole batch.
  const generate = async (slots: number[], force = false) => {
    if (!slots.length || busy) return;
    setError(null);
    setNotice(null);
    stopRef.current = false;
    setStopping(false);
    setQueueSize(slots.length);
    setQueueDone(0);
    setRunning(true);

    let consecutiveFailures = 0;
    let halted = false;
    const renderSlot = async (slot: number): Promise<boolean> => {
      setBusySlot(slot);
      let failure: string | null = null;
      try {
        const result = await generateImageAdCandidate(batchId, slot, force ? { force: true } : undefined);
        if (result.ok) {
          onCandidatesChange((current) => current.map((item) => item.slot === slot ? result.candidate : item));
          if (result.candidate.status === "ready" && !result.candidate.error) return true;
          failure = result.candidate.error ?? "Rendering failed.";
        } else {
          failure = result.error;
        }
      } catch {
        failure = "Lost connection to the server.";
      }
      // The server could not record this one itself, so reflect it locally.
      onCandidatesChange((current) => current.map((item) =>
        item.slot === slot && item.status !== "ready" ? { ...item, status: "failed", error: failure } : item));
      return false;
    };

    const failed: number[] = [];
    for (const slot of slots) {
      if (stopRef.current) break;
      if (await renderSlot(slot)) {
        consecutiveFailures = 0;
      } else {
        failed.push(slot);
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          halted = true;
          break;
        }
      }
      setQueueDone((done) => done + 1);
    }

    let stillFailed = failed.length;
    if (failed.length && !halted && !stopRef.current && slots.length > 1) {
      setQueueSize(failed.length);
      setQueueDone(0);
      stillFailed = 0;
      for (const slot of failed) {
        if (stopRef.current) break;
        if (!(await renderSlot(slot))) stillFailed += 1;
        setQueueDone((done) => done + 1);
      }
    }

    setBusySlot(null);
    setRunning(false);
    if (halted) {
      setError("Three images failed in a row, so the run was paused — the image service is probably having trouble. Finished images are saved. Wait a minute, then generate again to continue.");
    } else if (stopRef.current) {
      setNotice("Stopped. Finished images are saved — generate again to pick up where you left off.");
    } else if (stillFailed) {
      setNotice(`${stillFailed} image${stillFailed === 1 ? "" : "s"} still failed after a second try. Open the card to see why, then retry or skip it.`);
    }
  };

  const remainingSeconds = Math.max((queueSize - queueDone) * (queueDone > 0 ? runElapsed / queueDone : secondsPerImage), 0);

  // ── Empty state: nothing planned yet ────────────────────────────────────────
  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 p-6 text-center">
        {planning ? (
          <>
            <p className="text-sm font-medium text-ink-900">Planning {targetCount} concepts… {formatDuration(planElapsed)}</p>
            <p className="mt-1 text-xs text-ink-500">
              Reading the references and avatar research, then writing every headline and visual brief. Usually about a minute.
            </p>
            <div className="mx-auto mt-4 grid max-w-xl grid-cols-4 gap-2">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className={`skeleton-line ${aspectClass(format)} w-full rounded-lg`} />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-ink-900">Plan {targetCount} ad concepts</p>
            <p className="mx-auto mt-1 max-w-lg text-xs text-ink-500">
              We write {targetCount} distinct concepts — headline, copy, CTA, and a visual brief for each. About two thirds
              adapt a pattern from your references; the rest are original ideas from the avatar research. Nothing is
              rendered yet, so you can review before spending on images.
            </p>
            <button type="button" className="btn btn-primary mt-4" onClick={plan}>
              Plan {targetCount} concepts
            </button>
            <p className="mt-2 text-[11px] text-ink-400">Takes about a minute.</p>
          </>
        )}
        {error && <p role="alert" className="mx-auto mt-3 max-w-lg rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
      </div>
    );
  }

  // ── Gallery ─────────────────────────────────────────────────────────────────
  const allReady = counts.ready === candidates.length;
  // Until something has been rendered, the concepts are just words — show them
  // as readable text cards instead of a wall of empty image frames.
  const showImages = running || candidates.some((candidate) => candidate.imageUrl || candidate.status === "failed");
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tag">{referenceInformed} reference-informed</span>
          <span className="tag">{candidates.length - referenceInformed} original</span>
          {duplicates.size > 0 && <span className="tag tag-warn">{duplicates.size} near-duplicate</span>}
          {flagged > 0 && <span className="tag tag-danger">{flagged} claim flag{flagged === 1 ? "" : "s"}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(unbrandedSlots.length > 0 || branding) && (
            <button type="button" className="btn text-xs" onClick={addLogos} disabled={busy}>
              {branding ? "Updating logos..." : "Add or fix logos"}
            </button>
          )}
          {counts.ready === 0 && !running && (
            <button type="button" className="btn text-xs" onClick={plan} disabled={busy}>
              {planning ? `Re-planning… ${formatDuration(planElapsed)}` : "Re-plan concepts"}
            </button>
          )}
          {running ? (
            <button
              type="button"
              className="btn"
              disabled={stopping}
              onClick={() => { stopRef.current = true; setStopping(true); }}
            >
              {stopping ? "Stopping after this image…" : "Stop"}
            </button>
          ) : allReady ? (
            <span className="tag tag-ok">All {candidates.length} images ready</span>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => generate(todoSlots)} disabled={busy}>
              {counts.ready > 0 ? `Generate remaining ${todoSlots.length}` : `Generate ${candidates.length} images`}
            </button>
          )}
        </div>
      </div>

      {!running && !allReady && (
        <p className="mt-2 text-right text-[11px] text-ink-400">
          ≈ ${(todoSlots.length * costPerImage).toFixed(2)} · about {formatDuration(todoSlots.length * secondsPerImage)} · keep this tab open while it runs
        </p>
      )}

      {needsLogoRegeneration && (
        <p className="mt-2 text-xs text-ink-500">
          Some older images have a logo embedded over the artwork and no saved clean original.
          If text is covered, open the image and regenerate it to use the separate logo header. Generation charges apply.
        </p>
      )}

      {running && (
        <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <div className="flex items-center justify-between text-xs text-ink-600">
            <span>Rendering image {Math.min(queueDone + 1, queueSize)} of {queueSize}</span>
            <span>{queueDone > 0 ? `about ${formatDuration(Math.round(remainingSeconds))} left` : "estimating…"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-200">
            <div
              className="h-full rounded-full bg-brand-plum transition-all duration-500"
              style={{ width: `${Math.round((queueDone / Math.max(queueSize, 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {notice && <p className="mt-3 rounded-lg border border-ink-200 bg-ink-50 p-2 text-xs text-ink-600">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-1 text-xs">
        {([
          ["all", `All ${counts.total}`],
          ["ready", `Ready ${counts.ready}`],
          ["todo", `To do ${counts.pending}`],
          ...(counts.failed ? [["failed", `Failed ${counts.failed}`]] : []),
        ] as [Filter, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 transition ${
              filter === value ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            {label}
          </button>
        ))}
        {failedSlots.length > 0 && !running && (
          <button type="button" className="btn ml-auto text-xs" onClick={() => generate(failedSlots)} disabled={busy}>
            Retry {failedSlots.length} failed
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink-300 p-6 text-center text-sm text-ink-500">
          Nothing here yet.
        </p>
      ) : (
        <div className={`mt-3 grid gap-3 ${showImages ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          {visible.map((candidate) => {
            const rendering = busySlot === candidate.slot;
            return (
              <article key={candidate.slot} className="overflow-hidden rounded-xl border border-ink-200 bg-white transition hover:border-ink-400">
                <button
                  type="button"
                  className="block h-full w-full text-left"
                  onClick={() => { setOpenSlot(candidate.slot); setConfirmRegenerate(false); }}
                  aria-label={`Open concept ${candidate.slot + 1}: ${candidate.concept.headline}`}
                >
                  {showImages && (
                    <div className={`relative ${aspectClass(format)} bg-ink-100`}>
                      {candidate.imageUrl && !rendering ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidate.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : rendering ? (
                        <div className="skeleton-line flex h-full w-full items-center justify-center rounded-none">
                          <span className="relative z-10 text-[11px] font-medium text-ink-600">Rendering…</span>
                        </div>
                      ) : (
                        <div className={`flex h-full items-center justify-center px-3 text-center text-[11px] ${candidate.status === "failed" ? "text-red-700" : "text-ink-400"}`}>
                          {candidate.status === "failed" ? "Failed — open for details" : "Waiting to render"}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-1 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 px-1 text-[10px] font-semibold text-ink-600">
                        {candidate.slot + 1}
                      </span>
                      <div className={`text-xs font-medium text-ink-900 ${showImages ? "line-clamp-2" : ""}`}>{candidate.concept.headline}</div>
                    </div>
                    {!showImages && candidate.concept.bodyCopy && (
                      <p className="line-clamp-2 text-[11px] text-ink-600">{candidate.concept.bodyCopy}</p>
                    )}
                    <div className="truncate text-[10px] text-ink-400">{candidate.concept.direction}</div>
                    <div className="flex flex-wrap gap-1">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        candidate.concept.source === "reference_informed" ? "bg-brand-pink/20 text-brand-plum" : "bg-ink-100 text-ink-600"
                      }`}>
                        {candidate.concept.source === "reference_informed" ? "reference" : "original"}
                      </span>
                      {duplicates.has(candidate.slot) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">near-duplicate</span>}
                      {candidate.claimStatus === "flagged" && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">claim flag</span>}
                    </div>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {open && (
        <Lightbox
          src={open.imageUrl}
          alt={`Concept ${open.slot + 1}`}
          onClose={() => setOpenSlot(null)}
        >
          <div>
            <div className="text-sm font-semibold text-ink-900">{open.concept.headline}</div>
            {open.concept.bodyCopy && <p className="mt-1">{open.concept.bodyCopy}</p>}
            <span className="mt-2 inline-block rounded-full border border-ink-300 px-2.5 py-0.5 text-[11px] font-medium text-ink-800">
              {open.concept.cta}
            </span>
          </div>

          {open.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">{open.error}</p>
          )}
          {(open.claimFlags?.length ?? 0) > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">
              Check the wording: {open.claimFlags!.join(", ")}
            </p>
          )}

          <div>
            <div className="label">Direction</div>
            <p>{open.concept.direction} · {open.concept.execution}</p>
          </div>
          <div>
            <div className="label">Visual brief</div>
            <p>{open.concept.visualInstructions}</p>
          </div>
          {open.concept.rationale && (
            <div>
              <div className="label">Why this concept</div>
              <p>{open.concept.rationale}</p>
            </div>
          )}
          {open.concept.sourceReferenceIds.length > 0 && (
            <div>
              <div className="label">Inspired by</div>
              <ul className="space-y-0.5">
                {open.concept.sourceReferenceIds.map((id) => {
                  const reference = references.find((item) => item.adId === id);
                  return reference ? <li key={id}>{reference.brandName}</li> : null;
                })}
              </ul>
              {open.concept.rolesUsed.length > 0 && (
                <p className="mt-1 text-ink-400">
                  Borrowed: {open.concept.rolesUsed.map((role) => IMAGE_AD_REFERENCE_ROLES.find((item) => item.value === role)?.label ?? role).join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-ink-100 pt-3">
            {open.status === "ready" && open.imageUrl ? (
              <>
                <a className="btn btn-primary w-full" href={open.imageUrl} download={`ad-${String(open.slot + 1).padStart(2, "0")}.png`}>
                  Download image
                </a>
                {confirmRegenerate ? (
                  <button
                    type="button"
                    className="btn btn-danger w-full text-xs"
                    disabled={busy}
                    onClick={() => { setConfirmRegenerate(false); setOpenSlot(null); void generate([open.slot], true); }}
                  >
                    Replace this image (≈ ${costPerImage.toFixed(2)})
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost w-full text-xs" disabled={busy} onClick={() => setConfirmRegenerate(true)}>
                    Regenerate
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={busy}
                onClick={() => { setOpenSlot(null); void generate([open.slot]); }}
              >
                {open.status === "failed" ? "Retry this image" : "Generate this image"}
              </button>
            )}
            {open.width && open.height && (
              <p className="text-center text-[10px] text-ink-400">{open.width}×{open.height}px</p>
            )}
          </div>
        </Lightbox>
      )}
    </div>
  );
}
