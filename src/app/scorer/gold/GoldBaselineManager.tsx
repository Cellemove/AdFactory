"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CopyTaxonomyCodeRow,
  GoldAdRow,
  ScriptEvidenceRow,
} from "@/lib/database.types";
import {
  guessTaxonomyCode,
  normalizeScriptTimestampFormat,
  parseScriptTimestampBeats,
} from "@/lib/cellumove/script-beat-parse";
import {
  promoteEvidenceToGold,
  removeGoldAd,
  updateGoldCandidateScript,
} from "./actions";

type DraftBeat = {
  code: string;
  evidenceQuote: string;
  startSec: string;
  endSec: string;
  otherExplanation: string;
};

export function GoldBaselineManager({
  ads,
  beatCounts,
  candidates,
  taxonomy,
  angles,
  baselineVersion,
}: {
  ads: GoldAdRow[];
  beatCounts: Record<string, number>;
  candidates: ScriptEvidenceRow[];
  taxonomy: CopyTaxonomyCodeRow[];
  angles: Array<{ slug: string; name: string }>;
  baselineVersion: string;
}) {
  const router = useRouter();
  const [evidenceId, setEvidenceId] = useState(candidates[0]?.id ?? "");
  const [durationSec, setDurationSec] = useState("");
  // Angle/format are editable here so promotion never bounces you to the
  // evidence library; edits persist back onto the evidence row.
  const [angleSlug, setAngleSlug] = useState(candidates[0]?.angleSlug ?? "");
  const [format, setFormat] = useState(candidates[0]?.format ?? "");
  // Editable copy of the script — timestamps sometimes arrive flattened into
  // the prose; fixing them here is what makes beat generation possible.
  const [scriptDraft, setScriptDraft] = useState(
    candidates[0]?.scriptText ?? "",
  );
  const [beats, setBeats] = useState<DraftBeat[]>([
    emptyBeat(taxonomy[0]?.code ?? ""),
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const candidate = candidates.find((item) => item.id === evidenceId) ?? null;
  const taxonomyByCode = useMemo(
    () => new Map(taxonomy.map((item) => [item.code, item])),
    [taxonomy],
  );
  const cohortCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ads.forEach((ad) => {
      const key = `${ad.angleSlug} · ${ad.format}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ads]);

  const updateBeat = (index: number, patch: Partial<DraftBeat>) =>
    setBeats((current) =>
      current.map((beat, beatIndex) =>
        beatIndex === index ? { ...beat, ...patch } : beat,
      ),
    );
  // Scripts carry their own beat structure ("0:00 à 0:05 · Hook") — parse it
  // instead of hand-copying quotes. Codes are best-effort guesses to review.
  const scriptDirty =
    Boolean(candidate) && scriptDraft !== (candidate?.scriptText ?? "");
  const saveScript = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        await updateGoldCandidateScript({
          evidenceId,
          scriptText: scriptDraft,
        });
        setMessage("Script saved.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    });
  const normalizeScriptFormat = () => {
    if (!scriptDraft.trim()) return;
    const result = normalizeScriptTimestampFormat(scriptDraft);
    if (!result.detectedHeaderCount) {
      setMessage("No recognizable timestamp ranges were found to normalize.");
      return;
    }
    if (!result.changedHeaderCount) {
      setMessage("The script already uses the canonical timestamp format.");
      return;
    }
    setScriptDraft(result.scriptText);
    setMessage(
      `${result.changedHeaderCount} timestamp headers normalized. Review the script, then save it.`,
    );
  };
  const generateBeats = () => {
    if (!scriptDraft.trim()) return;
    const parsed = parseScriptTimestampBeats(scriptDraft);
    if (!parsed.length) {
      setMessage(
        'No timestamp ranges found. Use either "0:00 à 0:05 · Hook" or "BEAT 1 · Hook (0:00 - 0:05)".',
      );
      return;
    }
    const codes = new Set(taxonomy.map((item) => item.code));
    setBeats(
      parsed.map((beat, index) => {
        const guess = guessTaxonomyCode(beat.label, index, codes, {
          quote: beat.quote,
          startSec: beat.startSec,
        });
        return {
          code: guess.code,
          evidenceQuote: beat.quote,
          startSec: String(beat.startSec),
          endSec: String(beat.endSec),
          otherExplanation: guess.otherExplanation ?? "",
        };
      }),
    );
    if (!durationSec) setDurationSec(String(parsed[parsed.length - 1]!.endSec));
    setMessage(
      `${parsed.length} beats generated from the script's timestamps — review the taxonomy codes, then promote.`,
    );
  };
  const promote = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        await promoteEvidenceToGold({
          evidenceId,
          angleSlug: resolveAngleSlug(angleSlug, angles) || null,
          format: format.trim() || null,
          durationSec: durationSec ? Number(durationSec) : null,
          beats: beats.map((beat) => ({
            code: beat.code,
            evidenceQuote: beat.evidenceQuote,
            startSec: beat.startSec ? Number(beat.startSec) : null,
            endSec: beat.endSec ? Number(beat.endSec) : null,
            otherExplanation: beat.otherExplanation || null,
          })),
        });
        setMessage("Evidence promoted to the gold baseline.");
        setBeats([emptyBeat(taxonomy[0]?.code ?? "")]);
        setDurationSec("");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    });
  const remove = (id: string) =>
    startTransition(async () => {
      if (
        !window.confirm(
          "Remove this ad and all of its coded beats from the active gold baseline?",
        )
      )
        return;
      setMessage(null);
      try {
        await removeGoldAd(id);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-ink-500">
            Baseline
          </p>
          <p className="mt-2 text-xl font-semibold">{baselineVersion}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-ink-500">
            Gold ads
          </p>
          <p className="mt-2 text-xl font-semibold">{ads.length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-ink-500">
            Eligible candidates
          </p>
          <p className="mt-2 text-xl font-semibold">{candidates.length}</p>
          <p className="mt-1 text-xs text-ink-500">
            Approved + verified winner + script attached
          </p>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Promote and code a winner</h2>
          <p className="mt-1 text-xs text-ink-500">
            Every beat quote must be copied exactly from the attached script.
            Timing is optional, but start and end must be supplied together.
          </p>
        </div>
        {candidates.length ? (
          <>
            <label>
              <span className="label">Eligible evidence</span>
              <select
                className="input"
                value={evidenceId}
                onChange={(event) => {
                  const id = event.target.value;
                  setEvidenceId(id);
                  setMessage(null);
                  const pick = candidates.find((item) => item.id === id);
                  setAngleSlug(pick?.angleSlug ?? "");
                  setFormat(pick?.format ?? "");
                  setScriptDraft(pick?.scriptText ?? "");
                }}
              >
                <option value="">Choose evidence…</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.externalId ?? item.id} · {item.title}
                  </option>
                ))}
              </select>
            </label>
            {candidate && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-xl border border-ink-200 bg-ink-50 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="tag">{candidate.angleSlug}</span>
                    <span className="tag">{candidate.format}</span>
                    <span className="tag">
                      {candidate.marketCode ?? "all markets"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium">{candidate.title}</p>
                  <textarea
                    className="input mt-3 min-h-[32rem] whitespace-pre-wrap bg-white font-mono text-xs leading-5"
                    value={scriptDraft}
                    onChange={(event) => setScriptDraft(event.target.value)}
                    spellCheck={false}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="btn"
                      disabled={pending || !scriptDraft.trim()}
                      onClick={normalizeScriptFormat}
                    >
                      Normalize script format
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending || !scriptDirty}
                      onClick={saveScript}
                    >
                      {pending ? "Saving…" : "Save script"}
                    </button>
                    {scriptDirty && (
                      <span className="text-xs text-amber-700">
                        Unsaved script changes — save before promoting.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    Normalization changes recognized timestamp headings only;
                    script copy stays intact. Missing timings are never invented.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={generateBeats}
                      >
                        Generate beats from script
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setBeats((current) => [
                            ...current,
                            emptyBeat(taxonomy[0]?.code ?? ""),
                          ])
                        }
                      >
                        Add beat
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          pending ||
                          !evidenceId ||
                          scriptDirty ||
                          !angleSlug ||
                          !format.trim() ||
                          beats.some(
                            (beat) => !beat.code || !beat.evidenceQuote.trim(),
                          )
                        }
                        onClick={promote}
                      >
                        {pending ? "Saving…" : "Promote to gold baseline"}
                      </button>
                      {message && (
                        <p role="status" className="text-sm text-ink-600">
                          {message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label>
                      <span className="label">Angle</span>
                      <input
                        className="input"
                        list="gold-angle-options"
                        value={angleSlug}
                        onChange={(event) => setAngleSlug(event.target.value)}
                        placeholder="Choose or type a new angle…"
                      />
                      <datalist id="gold-angle-options">
                        {angles.map((angle) => (
                          <option key={angle.slug} value={angle.slug}>
                            {angle.name}
                          </option>
                        ))}
                      </datalist>
                      {angleSlug &&
                        resolveAngleSlug(angleSlug, angles) !== angleSlug && (
                          <p className="mt-1 text-xs text-ink-500">
                            Will be saved as{" "}
                            <code>{resolveAngleSlug(angleSlug, angles)}</code>
                          </p>
                        )}
                    </label>
                    <label>
                      <span className="label">Format</span>
                      <input
                        className="input"
                        value={format}
                        onChange={(event) => setFormat(event.target.value)}
                        placeholder="e.g. UGC, doctor VO, split screen"
                      />
                    </label>
                  </div>
                  <label>
                    <span className="label">Total duration in seconds</span>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="600"
                      step="0.1"
                      value={durationSec}
                      onChange={(event) => setDurationSec(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  {beats.map((beat, index) => {
                    const taxon = taxonomyByCode.get(beat.code);
                    const quoteMissing = Boolean(
                      beat.evidenceQuote &&
                      scriptDraft &&
                      !scriptDraft.includes(beat.evidenceQuote),
                    );
                    return (
                      <div
                        key={index}
                        className="rounded-xl border border-ink-200 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">
                            Beat {index + 1}
                          </p>
                          <button
                            type="button"
                            className="text-xs text-red-700 underline disabled:opacity-40"
                            disabled={beats.length === 1}
                            onClick={() =>
                              setBeats((current) =>
                                current.filter(
                                  (_, beatIndex) => beatIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="md:col-span-2">
                            <span className="label">Taxonomy code</span>
                            <select
                              className="input"
                              value={beat.code}
                              onChange={(event) =>
                                updateBeat(index, { code: event.target.value })
                              }
                            >
                              {taxonomy.map((item) => (
                                <option key={item.code} value={item.code}>
                                  {item.layer} · {item.label} ({item.code})
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <span className="label">Layer</span>
                            <div className="input bg-ink-50">
                              {taxon?.layer ?? "—"}
                            </div>
                          </div>
                        </div>
                        <label className="mt-3 block">
                          <span className="label">Exact script quote</span>
                          <textarea
                            className={`input min-h-20 ${quoteMissing ? "border-red-400" : ""}`}
                            value={beat.evidenceQuote}
                            onChange={(event) =>
                              updateBeat(index, {
                                evidenceQuote: event.target.value,
                              })
                            }
                          />
                        </label>
                        {quoteMissing && (
                          <p className="mt-1 text-xs text-red-700">
                            This is not an exact substring of the script.
                          </p>
                        )}
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label>
                            <span className="label">Start second</span>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="0.1"
                              value={beat.startSec}
                              onChange={(event) =>
                                updateBeat(index, {
                                  startSec: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span className="label">End second</span>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="0.1"
                              value={beat.endSec}
                              onChange={(event) =>
                                updateBeat(index, {
                                  endSec: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        {taxon?.layer === "OTHER" && (
                          <label className="mt-3 block">
                            <span className="label">Why this is OTHER</span>
                            <input
                              className="input"
                              value={beat.otherExplanation}
                              onChange={(event) =>
                                updateBeat(index, {
                                  otherExplanation: event.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No evidence is eligible yet. In the evidence library, set evidence
            strength to <strong>verified winner</strong>, set review status to{" "}
            <strong>approved</strong>, and ensure the script, angle, and format
            are present.
          </div>
        )}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Current gold ads</h2>
            <p className="mt-1 text-xs text-ink-500">
              Removing an ad also removes its coded beats from the active
              baseline.
            </p>
          </div>
          {cohortCounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cohortCounts.map(([cohort, count]) => (
                <span
                  key={cohort}
                  className={count >= 5 ? "tag tag-ok" : "tag tag-warn"}
                >
                  {cohort}: {count}/5
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="divider" />
        {ads.length ? (
          <ul className="divide-y divide-ink-200">
            {ads.map((ad) => (
              <li
                key={ad.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{ad.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className="tag">{ad.angleSlug}</span>
                    <span className="tag">{ad.format}</span>
                    <span className="tag">{beatCounts[ad.id] ?? 0} beats</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost text-xs text-red-700"
                  disabled={pending}
                  onClick={() => remove(ad.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-500">
            No ads have been promoted to this baseline.
          </p>
        )}
      </section>
    </div>
  );
}

function emptyBeat(code: string): DraftBeat {
  return {
    code,
    evidenceQuote: "",
    startSec: "",
    endSec: "",
    otherExplanation: "",
  };
}

// Typed input → angle slug: an existing angle's slug or name resolves to its
// slug; anything else becomes a new kebab-case slug (a new scorer cohort).
function resolveAngleSlug(
  value: string,
  angles: Array<{ slug: string; name: string }>,
): string {
  const typed = value.trim();
  if (!typed) return "";
  const lower = typed.toLowerCase();
  const known = angles.find(
    (angle) =>
      angle.slug.toLowerCase() === lower || angle.name.toLowerCase() === lower,
  );
  if (known) return known.slug;
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
