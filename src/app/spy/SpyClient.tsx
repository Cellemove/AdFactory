"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { spyOnCompetitors, updateSpyAds, type SpyAd } from "../actions/spy";
import { saveToBank } from "../actions/bank";
import { youtubeThumb } from "@/lib/video-thumb";

interface HistoryItem {
  id: string;
  focus: string | null;
  drafts: string; // JSON-stringified SpyAd[]
  createdAt: string;
  count: number;
}

interface LatestSweep {
  id: string;
  ads: SpyAd[];
  focus: string | null;
  createdAt: string;
}

// Live elapsed timer — same pattern as the Research page.
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
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The best image we can show for a creative: scraped image first, else a derived
// YouTube thumbnail.
function thumbFor(ad: SpyAd): string | null {
  return ad.imageUrl || youtubeThumb(ad.sourceUrl || "");
}

export function SpyClient({
  latest,
  history,
  bankedUrls = [],
}: {
  latest: LatestSweep | null;
  history: HistoryItem[];
  /** Source URLs already in the idea bank, so saved tiles render as saved. */
  bankedUrls?: string[];
}) {
  const [ads, setAds] = useState<SpyAd[] | null>(latest?.ads ?? null);
  const [sweepId, setSweepId] = useState<string | null>(latest?.id ?? null);
  const [meta, setMeta] = useState<{ focus: string | null; createdAt: string } | null>(
    latest ? { focus: latest.focus, createdAt: latest.createdAt } : null,
  );
  const [focus, setFocus] = useState("");
  const [hideUnverified, setHideUnverified] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [, startTransition] = useTransition();
  const elapsed = useElapsedMs(isRunning);
  const autoRan = useRef(false);
  // Which creatives are already banked, keyed by the same value the action uses
  // as its dedupe key (sourceUrl, falling back to imageUrl).
  const [banked, setBanked] = useState<Set<string>>(() => new Set(bankedUrls));
  const [saving, setSaving] = useState<string | null>(null);

  const bankKey = (ad: SpyAd) => (ad.sourceUrl || ad.imageUrl || "").trim();

  const keepAd = (ad: SpyAd) => {
    const key = bankKey(ad);
    if (!key || banked.has(key)) return;
    setError(null);
    setSaving(key);
    startTransition(async () => {
      try {
        const res = await saveToBank(ad, sweepId);
        if (res.saved) setBanked((prev) => new Set(prev).add(key));
        else setError(res.reason ?? "Couldn't save that creative.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    });
  };

  const run = (focusOverride?: string | null) => {
    const f = focusOverride !== undefined ? focusOverride : focus || null;
    setError(null);
    setIsRunning(true);
    startTransition(async () => {
      try {
        const result = await spyOnCompetitors(f);
        setAds(result.ads);
        setSweepId(result.id);
        setMeta({ focus: f, createdAt: new Date().toISOString() });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    });
  };

  // "Whenever we access the spy page, show me an array" — if there's no cached
  // sweep to show, kick one off automatically on first mount.
  useEffect(() => {
    if (!autoRan.current && !latest && !isRunning) {
      autoRan.current = true;
      run(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove a creative from the current view and persist the curated list.
  const removeAd = (index: number) => {
    if (!ads) return;
    const next = ads.filter((_, i) => i !== index);
    setAds(next);
    if (sweepId) {
      const id = sweepId;
      startTransition(async () => {
        try {
          await updateSpyAds(id, next);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    }
  };

  const openHistory = (h: HistoryItem) => {
    try {
      const parsed = JSON.parse(h.drafts) as SpyAd[];
      if (Array.isArray(parsed)) {
        setAds(parsed);
        setSweepId(h.id);
        setMeta({ focus: h.focus, createdAt: h.createdAt });
        setError(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Couldn't parse that saved sweep.");
    }
  };

  // Keep original indices so removal/curation stays correct when filtering.
  const visibleAds = (ads ?? [])
    .map((ad, index) => ({ ad, index }))
    .filter(({ ad }) => !hideUnverified || ad.verified !== false);
  const unverifiedCount = (ads ?? []).filter((a) => a.verified === false).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spy</h1>
          <p className="text-sm text-ink-500">
            What competitor 3D-shaping legging brands are posting right now — a live feed of their
            trending ad creatives. Click a tile to open the source; hit ✕ to remove ones you don&apos;t need.
          </p>
        </div>
        {meta && (
          <span className="text-xs text-ink-400">
            {ads?.length ?? 0} creatives · {new Date(meta.createdAt).toLocaleString()}
            {meta.focus ? ` · focus: “${meta.focus}”` : ""}
          </span>
        )}
      </header>

      <section className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input flex-1"
            placeholder="Focus (optional) — e.g. 'butt-lift angle' or 'TikTok Shop brands'"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            disabled={isRunning}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning) run();
            }}
          />
          <button className="btn btn-primary sm:w-56" onClick={() => run()} disabled={isRunning}>
            {isRunning ? `Scouting… ${formatElapsed(elapsed)} / ~40-90s` : "Refresh trending ads"}
          </button>
        </div>
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
        {isRunning && (
          <p className="mt-2 text-xs text-ink-500">
            Searching Meta Ads Library, TikTok, Instagram and YouTube ads, then pulling each
            creative&apos;s preview image. Give it a moment — this is a real web sweep.
          </p>
        )}
      </section>

      {/* Verification controls */}
      {ads && ads.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span>
            {visibleAds.length} shown
            {unverifiedCount > 0 ? ` · ${unverifiedCount} unverified (dead/blocked link)` : " · all links verified live"}
          </span>
          {unverifiedCount > 0 && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hideUnverified}
                onChange={(e) => setHideUnverified(e.target.checked)}
              />
              Hide unverified
            </label>
          )}
        </div>
      )}

      {/* The gallery */}
      {ads && ads.length > 0 ? (
        <AdGallery
          items={visibleAds}
          onRemove={removeAd}
          onKeep={keepAd}
          isBanked={(ad) => banked.has(bankKey(ad))}
          savingKey={saving}
          bankKey={bankKey}
        />
      ) : !isRunning ? (
        <section className="card text-sm text-ink-500">
          No creatives yet. Hit <span className="font-medium text-ink-700">Refresh trending ads</span> to
          pull the latest competitor feed.
        </section>
      ) : (
        <GallerySkeleton />
      )}

      {history.length > 0 && (
        <section className="card">
          <h2 className="text-sm font-semibold">Past sweeps</h2>
          <p className="mt-0.5 text-xs text-ink-500">The last {history.length} competitor scouts.</p>
          <div className="divider" />
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => openHistory(h)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-white p-3 text-left transition hover:border-ink-900 hover:bg-ink-50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      <span className="tag">Spy</span>
                      {h.focus ? (
                        <span className="ml-2">focus: “{h.focus}”</span>
                      ) : (
                        <span className="ml-2 text-ink-500">open sweep</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500">
                      {h.count} creatives · {new Date(h.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-xs text-ink-500">view →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Masonry gallery ─────────────────────────────────────────────────────────
function AdGallery({
  items,
  onRemove,
  onKeep,
  isBanked,
  savingKey,
  bankKey,
}: {
  items: { ad: SpyAd; index: number }[];
  onRemove: (index: number) => void;
  onKeep: (ad: SpyAd) => void;
  isBanked: (ad: SpyAd) => boolean;
  savingKey: string | null;
  bankKey: (ad: SpyAd) => string;
}) {
  return (
    <div className="gap-3 columns-2 sm:columns-3 lg:columns-4 [column-fill:_balance]">
      {items.map(({ ad, index }) => (
        <AdTile
          key={`${ad.sourceUrl}-${index}`}
          ad={ad}
          onRemove={() => onRemove(index)}
          onKeep={() => onKeep(ad)}
          banked={isBanked(ad)}
          saving={savingKey !== null && savingKey === bankKey(ad)}
        />
      ))}
    </div>
  );
}

function VerificationBadge({ ad }: { ad: SpyAd }) {
  if (ad.verified === undefined) return null; // legacy sweep, not checked
  const [cls, label, title] =
    ad.verified === false
      ? ["bg-red-600/90 text-white", "unverified", "This link did not load — likely a dead or fabricated URL."]
      : ad.contentMatch
        ? ["bg-emerald-600/90 text-white", "✓ verified", "Link is live and the brand/caption was found on the page."]
        : ["bg-amber-500/90 text-white", "live · unmatched", "Link loads, but the claimed brand/caption wasn't found on the page."];
  return (
    <span
      className={`absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
      title={title}
    >
      {label}
    </span>
  );
}

function AdTile({
  ad,
  onRemove,
  onKeep,
  banked,
  saving,
}: {
  ad: SpyAd;
  onRemove: () => void;
  onKeep: () => void;
  banked: boolean;
  saving: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const href = ad.sourceUrl || ad.imageUrl;
  const img = thumbFor(ad);

  return (
    <div className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-lg border border-ink-200 bg-white transition hover:border-ink-900 hover:shadow-md">
      {/* Keep + remove. A banked tile keeps its badge visible so you can see at a
          glance what you've already taken from this sweep. */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onKeep();
          }}
          disabled={banked || saving}
          aria-label={banked ? "Already in the idea bank" : "Save to bank"}
          title={banked ? "In the idea bank" : "Save to bank"}
          className={`flex h-6 items-center rounded-full px-2 text-[10px] font-medium leading-none transition ${
            banked
              ? "bg-emerald-600/90 text-white opacity-100"
              : "bg-black/60 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100 disabled:opacity-60"
          }`}
        >
          {banked ? "★ banked" : saving ? "saving…" : "★ save"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove this creative"
          title="Remove"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm leading-none text-white opacity-0 transition hover:bg-black/80 group-hover:opacity-100"
        >
          ✕
        </button>
      </div>

      <a href={href || undefined} target="_blank" rel="noopener noreferrer" className="block">
        <div className="relative">
          {broken || !img ? (
            <div className="flex aspect-[3/4] items-center justify-center bg-ink-100 px-3 text-center text-xs text-ink-500">
              {hostOf(href)} ↗
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt={ad.caption || ad.brand}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              onLoad={(e) => {
                // YouTube serves a 120×90 gray "video not found" placeholder (HTTP
                // 200) for dead ids — treat that tiny image as broken.
                if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth <= 120) {
                  setBroken(true);
                }
              }}
              className="w-full bg-ink-100 object-cover"
            />
          )}
          {ad.mediaType === "video" && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
              ▶ video
            </span>
          )}
          {ad.platform && (
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
              {ad.platform}
            </span>
          )}
          <VerificationBadge ad={ad} />
        </div>
        <div className="p-2.5">
          <div className="truncate text-sm font-semibold text-ink-900">{ad.brand || hostOf(href)}</div>
          {ad.caption && <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{ad.caption}</p>}
        </div>
      </a>
    </div>
  );
}

function GallerySkeleton() {
  const heights = ["h-56", "h-72", "h-48", "h-64", "h-60", "h-52", "h-72", "h-56"];
  return (
    <div className="gap-3 columns-2 sm:columns-3 lg:columns-4">
      {heights.map((h, i) => (
        <div key={i} className={`mb-3 break-inside-avoid rounded-lg bg-ink-100 ${h} animate-pulse`} />
      ))}
    </div>
  );
}
