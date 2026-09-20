"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { saveImageAdReferences } from "@/app/actions/image-ads";
import {
  IMAGE_AD_REFERENCE_ROLES,
  referenceDimensionsTooSmall,
  type ImageAdReferenceOption,
  type ImageAdReferenceRole,
  type ImageAdReferenceSelection,
  type ImageAdReferenceSnapshot,
} from "@/lib/cellumove/image-ad-references";
import { Lightbox, formatDuration, useElapsed } from "../ui";

const MIN_REFERENCES = 3;
const MAX_REFERENCES = 5;

function normalize(selections: ImageAdReferenceSelection[]) {
  return selections
    .map((selection) => ({ adId: selection.adId, roles: [...new Set(selection.roles)].sort() }))
    .sort((a, b) => a.adId.localeCompare(b.adId));
}

export function ReferenceAdPicker({
  batchId,
  avatarName,
  angleName,
  options,
  savedReferences,
  onSaved,
  onCancel,
}: {
  batchId: string;
  avatarName: string;
  angleName: string;
  options: ImageAdReferenceOption[];
  savedReferences: ImageAdReferenceSnapshot[];
  onSaved: (references: ImageAdReferenceSnapshot[]) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<ImageAdReferenceSelection[]>(() =>
    savedReferences.map((reference) => ({ adId: reference.adId, roles: reference.roles })),
  );
  const [brand, setBrand] = useState("all");
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // adId → natural size, for ads the server-side quality check would reject.
  const [tooSmall, setTooSmall] = useState<Map<string, string>>(new Map());
  const [preview, setPreview] = useState<ImageAdReferenceOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(saving);

  // Classify a tile from the loaded <img>: dead media, or a thumbnail the
  // server-side quality check would reject. `null` means the load failed.
  const inspect = (adId: string, element: HTMLImageElement | null) => {
    if (!element || element.naturalWidth === 0) {
      setBroken((current) => current.has(adId) ? current : new Set(current).add(adId));
      return;
    }
    const { naturalWidth, naturalHeight } = element;
    if (referenceDimensionsTooSmall(naturalWidth, naturalHeight)) {
      setTooSmall((current) => current.has(adId) ? current : new Map(current).set(adId, `${naturalWidth}×${naturalHeight}`));
    }
  };

  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const brands = useMemo(
    () => [...new Set(options.map((option) => option.brandName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [options],
  );
  // Cheap relevance signal: how many words of the avatar/angle show up in the
  // competitor name or ad copy. Enough to float likely-relevant ads to the top.
  const relevanceTerms = useMemo(
    () => [...new Set(`${avatarName} ${angleName}`.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4))],
    [avatarName, angleName],
  );
  const selectedIds = new Set(draft.map((selection) => selection.adId));
  // Dead media and thumbnail-only ads cannot be used, so they leave the grid
  // rather than sit there greyed out. A selected ad always stays visible.
  const unusable = (adId: string) => !selectedIds.has(adId) && (broken.has(adId) || tooSmall.has(adId));
  const hiddenCount = options.filter((option) => unusable(option.id)).length;
  const visible = useMemo(() => options
    .filter((option) => brand === "all" || option.brandName === brand)
    .sort((a, b) => {
      const score = (option: ImageAdReferenceOption) => {
        const haystack = `${option.brandName} ${option.copy}`.toLocaleLowerCase();
        return relevanceTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      };
      return score(b) - score(a) || a.brandName.localeCompare(b.brandName);
    }), [brand, options, relevanceTerms]);

  const selectedBrands = new Set(draft.map((selection) => byId.get(selection.adId)?.brandName).filter(Boolean));
  const checks = [
    { label: `${MIN_REFERENCES}–${MAX_REFERENCES} ads selected`, ok: draft.length >= MIN_REFERENCES && draft.length <= MAX_REFERENCES },
    { label: "From at least 2 competitors", ok: selectedBrands.size >= 2 },
    { label: "Every ad has a role", ok: draft.length > 0 && draft.every((selection) => selection.roles.length > 0) },
  ];
  const valid = checks.every((check) => check.ok);
  const dirty = JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(
    savedReferences.map((reference) => ({ adId: reference.adId, roles: reference.roles })),
  ));
  const full = draft.length >= MAX_REFERENCES;

  const toggleAd = (adId: string) => {
    if (saving) return;
    setError(null);
    setDraft((current) => current.some((selection) => selection.adId === adId)
      ? current.filter((selection) => selection.adId !== adId)
      : current.length < MAX_REFERENCES ? [...current, { adId, roles: [] }] : current);
  };
  const toggleRole = (adId: string, role: ImageAdReferenceRole) => {
    if (saving) return;
    setError(null);
    setDraft((current) => current.map((selection) => selection.adId !== adId ? selection : {
      ...selection,
      roles: selection.roles.includes(role)
        ? selection.roles.filter((value) => value !== role)
        : [...selection.roles, role],
    }));
  };
  const save = async () => {
    if (!valid || saving) return;
    setError(null);
    setSaving(true);
    try {
      const result = await saveImageAdReferences(batchId, draft);
      if (result.ok) onSaved(result.references);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 p-6 text-center text-sm text-ink-600">
        No usable BrandSearch winner images are indexed yet.
        <div className="mt-3">
          <Link href="/spy" className="btn btn-primary">Open Spy and refresh BrandSearch</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Ad pool */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by competitor"
            className="input h-9 w-auto py-0 text-xs"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            disabled={saving}
          >
            <option value="all">All competitors ({brands.length})</option>
            {brands.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="text-xs text-ink-400">
            Most relevant to {avatarName} first
            {hiddenCount > 0 && ` · ${hiddenCount} hidden (expired or thumbnail-only)`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visible.filter((option) => !unusable(option.id)).map((option, index) => {
            const selected = selectedIds.has(option.id);
            const expired = broken.has(option.id);
            const unavailable = expired || tooSmall.has(option.id);
            const disabled = saving || unavailable || (!selected && full);
            return (
              <div
                key={option.id}
                className={`relative overflow-hidden rounded-xl border bg-white transition ${
                  selected ? "border-brand-plum ring-2 ring-brand-pink/40" : "border-ink-200"
                } ${disabled && !selected ? "opacity-45" : ""}`}
              >
                <button
                  type="button"
                  className="block w-full text-left disabled:cursor-not-allowed"
                  onClick={() => toggleAd(option.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={`${selected ? "Remove" : "Select"} ${option.brandName} ad`}
                >
                  <div className="relative aspect-[4/5] bg-ink-100">
                    {expired ? (
                      <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-ink-400">
                        Image expired on BrandSearch
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={option.imageUrl!}
                        alt=""
                        className="h-full w-full object-cover"
                        loading={index < 24 ? "eager" : "lazy"}
                        referrerPolicy="no-referrer"
                        onError={() => inspect(option.id, null)}
                        onLoad={(event) => inspect(option.id, event.currentTarget)}
                        // An image that finished before hydration never fires
                        // onLoad/onError, so check it as soon as it mounts.
                        ref={(element) => { if (element?.complete) inspect(option.id, element); }}
                      />
                    )}
                    <span className="absolute left-2 top-2 max-w-[70%] truncate rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                      {option.brandName}
                    </span>
                    {tooSmall.has(option.id) && (
                      <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/75 px-2 py-1 text-center text-[10px] text-white">
                        Thumbnail only ({tooSmall.get(option.id)}) — too small to use
                      </span>
                    )}
                    {selected && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-brand-plum px-2 py-0.5 text-[10px] font-semibold text-white">
                        ✓ Selected
                      </span>
                    )}
                    {option.winnerEvidence === "verified_winner" && (
                      <span className="absolute bottom-2 left-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-amber-950">
                        verified winner
                      </span>
                    )}
                  </div>
                  {option.copy && <p className="line-clamp-2 px-2.5 py-2 text-[11px] text-ink-600">{option.copy}</p>}
                </button>
                {!unavailable && (
                  <button
                    type="button"
                    onClick={() => setPreview(option)}
                    className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-ink-800 shadow-sm transition hover:bg-white"
                    aria-label={`View ${option.brandName} ad full size`}
                  >
                    View
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selection tray */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-ink-900">Your references</h3>
            <span className="text-xs text-ink-500">{draft.length} of {MAX_REFERENCES}</span>
          </div>

          {draft.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-ink-300 bg-white p-3 text-xs text-ink-500">
              Click any ad to add it. Pick {MIN_REFERENCES}–{MAX_REFERENCES} from at least two competitors, then tell us what each one should inspire.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {draft.map((selection) => {
                const option = byId.get(selection.adId);
                if (!option) return null;
                return (
                  <li key={selection.adId} className="rounded-lg border border-ink-200 bg-white p-2">
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={option.imageUrl!}
                        alt=""
                        className="h-11 w-9 shrink-0 rounded object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-900">{option.brandName}</span>
                      <button
                        type="button"
                        className="rounded-full px-1.5 text-sm text-ink-400 hover:bg-ink-100 hover:text-ink-900"
                        onClick={() => toggleAd(selection.adId)}
                        disabled={saving}
                        aria-label={`Remove ${option.brandName}`}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {IMAGE_AD_REFERENCE_ROLES.map((role) => {
                        const active = selection.roles.includes(role.value);
                        return (
                          <button
                            key={role.value}
                            type="button"
                            onClick={() => toggleRole(selection.adId, role.value)}
                            disabled={saving}
                            aria-pressed={active}
                            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                              active
                                ? "border-brand-plum bg-brand-plum text-white"
                                : "border-ink-200 bg-white text-ink-600 hover:border-ink-400"
                            }`}
                          >
                            {role.label}
                          </button>
                        );
                      })}
                    </div>
                    {selection.roles.length === 0 && (
                      <p className="mt-1.5 text-[10px] text-amber-700">Choose what this ad should inspire.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <ul className="mt-3 space-y-1">
            {checks.map((check) => (
              <li key={check.label} className={`flex items-center gap-1.5 text-xs ${check.ok ? "text-emerald-700" : "text-ink-400"}`}>
                <span aria-hidden>{check.ok ? "✓" : "○"}</span>
                {check.label}
              </li>
            ))}
          </ul>

          <button type="button" className="btn btn-primary mt-3 w-full" onClick={save} disabled={!valid || !dirty || saving}>
            {saving ? `Checking images… ${formatDuration(elapsed)}` : "Save references"}
          </button>
          {onCancel && !saving && (
            <button type="button" className="btn btn-ghost mt-1.5 w-full text-xs" onClick={onCancel}>
              Cancel
            </button>
          )}
          {saving && (
            <p className="mt-2 text-[11px] text-ink-500">
              Downloading each image, checking its resolution, and analyzing only the roles you assigned. About 10 seconds per new ad.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>
          )}
        </div>
        <p className="mt-2 px-1 text-[11px] text-ink-400">
          Winner labels reflect longevity and spend signals, not verified ROAS. References guide execution — nothing is copied.
        </p>
      </aside>

      {preview && (
        <Lightbox src={preview.imageUrl!} alt={`${preview.brandName} ad`} onClose={() => setPreview(null)}>
          {preview.copy && <p>{preview.copy}</p>}
          {Array.isArray(preview.evidenceReasons) && preview.evidenceReasons.length > 0 && (
            <div>
              <div className="label">Why it counts as a winner</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {preview.evidenceReasons.filter((reason): reason is string => typeof reason === "string").map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.sourceUrl && (
            <a className="underline" href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">Open source ad ↗</a>
          )}
        </Lightbox>
      )}
    </div>
  );
}
