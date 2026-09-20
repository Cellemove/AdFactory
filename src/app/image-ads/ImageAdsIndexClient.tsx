"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createImageAdBatch } from "../actions/image-ads";
import {
  DEFAULT_IMAGE_AD_FORMAT,
  DEFAULT_IMAGE_AD_TARGET_COUNT,
  IMAGE_AD_FORMATS,
  IMAGE_AD_TARGET_COUNTS,
} from "@/lib/cellumove/image-ad-batch";

export interface SubOption {
  id: string;
  name: string;
  angleName: string;
}
export interface ProductOption {
  id: string;
  name: string;
}
export interface BatchSummary {
  id: string;
  label: string;
  avatarName: string | null;
  angleSlug: string | null;
  createdAt: string;
  targetCount: number;
  format: string;
  referencesReady: boolean;
  plannedCount: number;
  readyCount: number;
  thumbnails: string[];
}

function batchStatus(batch: BatchSummary): { label: string; tone: string } {
  if (!batch.referencesReady) return { label: "Needs references", tone: "tag-warn" };
  if (batch.plannedCount === 0) return { label: "Ready to plan", tone: "" };
  if (batch.readyCount >= batch.plannedCount) return { label: "Complete", tone: "tag-ok" };
  return { label: `${batch.readyCount} of ${batch.plannedCount} images`, tone: "" };
}

function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="label">{legend}</legend>
      <div className="inline-flex rounded-lg border border-ink-300 bg-white p-0.5">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              value === option.value ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ImageAdsIndexClient({
  subOptions,
  productOptions,
  batches,
}: {
  subOptions: SubOption[];
  productOptions: ProductOption[];
  batches: BatchSummary[];
}) {
  const router = useRouter();
  const [subAvatarId, setSubAvatarId] = useState(subOptions[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [label, setLabel] = useState("");
  const [targetCount, setTargetCount] = useState<number>(DEFAULT_IMAGE_AD_TARGET_COUNT);
  const [format, setFormat] = useState<string>(DEFAULT_IMAGE_AD_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const start = async () => {
    if (!subAvatarId || creating) return;
    setError(null);
    setCreating(true);
    try {
      const result = await createImageAdBatch({ subAvatarId, productId: productId || null, label, targetCount, format });
      if (result.ok) {
        router.push(`/image-ads/${result.batchId}`);
        return; // stay in the "creating" state while the next page loads
      }
      setError(result.error);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">AI Ads Image Bank</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Turn winning competitor ads into a batch of ready-to-review image ads. Pick references, plan the concepts,
          generate the images.
        </p>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">New batch</h2>
        {subOptions.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-ink-300 p-4 text-sm text-ink-500">
            You need an avatar first. Create one under{" "}
            <Link href="/research" className="underline hover:text-ink-900">Research</Link>.
          </p>
        ) : (
          <form
            className="mt-3 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <div className="grid-fields">
              <div>
                <label className="label" htmlFor="batch-avatar">Who is it for?</label>
                <select
                  id="batch-avatar"
                  className="input"
                  value={subAvatarId}
                  onChange={(event) => setSubAvatarId(event.target.value)}
                  disabled={creating}
                >
                  {subOptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.name} · {sub.angleName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="batch-product">Product</label>
                <select
                  id="batch-product"
                  className="input"
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  disabled={creating}
                >
                  <option value="">No specific product</option>
                  {productOptions.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-ink-400">Its photo is used so the product looks right in every ad.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Segmented
                legend="How many ads"
                value={targetCount}
                options={IMAGE_AD_TARGET_COUNTS.map((count) => ({ value: count as number, label: String(count) }))}
                onChange={setTargetCount}
                disabled={creating}
              />
              <Segmented
                legend="Format"
                value={format}
                options={IMAGE_AD_FORMATS.map((option) => ({ value: option.value as string, label: option.value }))}
                onChange={setFormat}
                disabled={creating}
              />
              <div className="min-w-[14rem] flex-1">
                <label className="label" htmlFor="batch-label">Name (optional)</label>
                <input
                  id="batch-label"
                  className="input"
                  placeholder="e.g. Q4 compression offer"
                  value={label}
                  maxLength={120}
                  onChange={(event) => setLabel(event.target.value)}
                  disabled={creating}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating || !subAvatarId}>
                {creating ? "Creating…" : "Create batch →"}
              </button>
            </div>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Your batches</h2>
        {batches.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500">
            No batches yet. Create your first one above.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((batch) => {
              const status = batchStatus(batch);
              const progress = batch.plannedCount ? Math.round((batch.readyCount / batch.plannedCount) * 100) : 0;
              return (
                <li key={batch.id}>
                  <Link href={`/image-ads/${batch.id}`} className="card card-interactive block p-3">
                    <div className="grid h-24 grid-cols-4 gap-1 overflow-hidden rounded-lg bg-ink-100">
                      {batch.thumbnails.length === 0 ? (
                        <div className="col-span-4 flex items-center justify-center text-[11px] text-ink-400">
                          No references yet
                        </div>
                      ) : (
                        batch.thumbnails.map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={url} src={url} alt="" className="h-24 w-full object-cover" loading="lazy" />
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink-900">
                          {batch.label || batch.avatarName || "Image ad batch"}
                        </div>
                        <div className="truncate text-xs text-ink-500">
                          {batch.label && batch.avatarName ? `${batch.avatarName} · ` : ""}
                          {batch.targetCount} ads · {batch.format} · {new Date(batch.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={`tag shrink-0 ${status.tone}`}>{status.label}</span>
                    </div>
                    {batch.plannedCount > 0 && (
                      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-plum" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
