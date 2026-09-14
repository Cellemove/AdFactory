import Link from "next/link";
import type { BrandSummary } from "../types";
import { AlertIcon, CheckIcon } from "./icons";

const STATE_LABEL: Record<BrandSummary["state"], string> = {
  untouched: "Not started",
  collecting: "Collected",
  processing: "In progress",
  ready: "Ready",
  attention: "Needs a look",
};

function BrandCard({ brand, selected, size = "rail" }: { brand: BrandSummary; selected: boolean; size?: "rail" | "grid" }) {
  const percent = Math.round(brand.percent * 100);
  return (
    <Link
      href={`/miner?brand=${encodeURIComponent(brand.domain)}`}
      aria-current={selected ? "true" : undefined}
      className={`card card-interactive relative block overflow-hidden ${size === "rail" ? "w-56 shrink-0 p-3.5" : "p-4"} ${selected ? "ring-2 ring-brand-pink/40" : ""}`}
    >
      {/* The fill is the progress: readable at a glance from across the room. */}
      <span aria-hidden className="absolute inset-y-0 left-0 bg-brand-blush/60 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      <span className="relative block">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink-900">{brand.name}</span>
          {brand.state === "ready" && <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" />}
          {brand.state === "attention" && <AlertIcon className="h-4 w-4 shrink-0 text-amber-600" />}
        </span>
        <span className="mt-1 flex items-baseline gap-1.5 text-xs text-ink-500">
          <span className="font-semibold tabular-nums text-ink-700">{brand.inCorpus}</span>
          <span>ads</span>
          {brand.inCorpus > 0 && <><span aria-hidden>·</span><span className="tabular-nums">{percent}%</span></>}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-400">
          {STATE_LABEL[brand.state]}
          {brand.needsReview > 0 && ` · ${brand.needsReview} to review`}
          {!brand.tracked && " · no longer tracked"}
        </span>
      </span>
    </Link>
  );
}

/** Horizontal rail above the run card. Every tracked competitor appears, so untouched brands read as a to-do list. */
export function BrandRail({ brands, selected }: { brands: BrandSummary[]; selected: string | null }) {
  if (!brands.length) return null;
  return (
    <section aria-label="Competitors" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex gap-2.5">
        {brands.map((brand) => (
          <BrandCard key={brand.domain} brand={brand} selected={brand.domain === selected} />
        ))}
      </div>
    </section>
  );
}

/** First screen when no brand is chosen: the same cards, full width. */
export function BrandPicker({ brands, unavailable }: { brands: BrandSummary[]; unavailable: boolean }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Pick a competitor</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          One competitor at a time. About 100 of their winning ads is enough to see how they write and how their ads are built. Choose who to study first — it takes about an hour and you only pay for it once.
        </p>
      </div>
      {unavailable && (
        <div className="card border-amber-200 bg-amber-50/70 text-sm text-amber-900">
          Could not reach BrandSearch to list your tracked competitors. The brands you have already worked on are shown below.
        </div>
      )}
      {brands.length === 0
        ? <div className="card py-10 text-center text-sm text-ink-500">No competitors tracked yet. Add them in BrandSearch under Swipe Files → Spectre.</div>
        : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((brand) => <BrandCard key={brand.domain} brand={brand} selected={false} size="grid" />)}
          </div>
        )}
    </section>
  );
}
