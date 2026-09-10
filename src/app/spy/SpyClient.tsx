"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateSpyAds, type SpyAd } from "../actions/spy";
import { saveToBank } from "../actions/bank";
import { importBrandSearchMetaAds } from "../actions/brandsearch";
import { isFeedStale, matchCompetitor, type SpectreCompetitor } from "@/lib/brandsearch";

interface CachedFeed {
  id: string;
  ads: SpyAd[];
  createdAt: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SpyClient({
  cached,
  bankedUrls = [],
  brandSearchConfigured,
  canRefresh,
  competitors,
}: {
  /** Newest cached BrandSearch Spectre feed, or null if none has been fetched yet. */
  cached: CachedFeed | null;
  /** Source URLs already in the idea bank, so saved tiles render as saved. */
  bankedUrls?: string[];
  brandSearchConfigured: boolean;
  /** Viewer may spend BrandSearch credits (creative strategists only). */
  canRefresh: boolean;
  /** BrandSearch Spectre competitors; null when the list couldn't be loaded. */
  competitors: SpectreCompetitor[] | null;
}) {
  const [ads, setAds] = useState<SpyAd[] | null>(cached?.ads ?? null);
  const [sweepId, setSweepId] = useState<string | null>(cached?.id ?? null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(cached?.createdAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, startTransition] = useTransition();
  const autoRan = useRef(false);
  // Read the clock after mount so server and client render the same markup.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [fetchedAt]);
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

  // Re-fetch the feed from BrandSearch and cache it (costs ~1 credit per ad).
  // `auto` = triggered by a missing/expired cache; the server re-checks the
  // cache first in case another viewer already refreshed it.
  const refresh = (auto = false) => {
    setError(null);
    setStatus(null);
    setRefreshing(true);
    startTransition(async () => {
      try {
        const result = await importBrandSearchMetaAds({ ifStale: auto });
        setAds(result.ads);
        setSweepId(result.id);
        setFetchedAt(result.createdAt);
        if (!result.reused) {
          const credits = result.creditsUsed === null ? null : `${result.creditsUsed.toLocaleString()} credits used`;
          const quota = result.dailyRemaining === null ? null : `${result.dailyRemaining.toLocaleString()} daily credits left`;
          const lead = auto && cached
            ? `Image links had expired, so the feed was refreshed · ${result.ads.length} ads`
            : `${result.ads.length} ads fetched`;
          setStatus([lead, credits, quota].filter(Boolean).join(" · "));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRefreshing(false);
      }
    });
  };

  // No cache yet, or its BrandSearch media links have expired → fetch once
  // automatically. Otherwise the cache is served until someone hits Refresh.
  useEffect(() => {
    if (autoRan.current || !canRefresh || !brandSearchConfigured) return;
    if (!cached || isFeedStale(cached.createdAt)) {
      autoRan.current = true;
      refresh(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove a creative from the feed and persist the curated list.
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

  // Keep original indices so removal and "Use this idea" links stay correct.
  // Brands dropped from Spectre since the cache was fetched are hidden.
  const visibleAds = (ads ?? [])
    .map((ad, index) => ({ ad, index }))
    .filter(({ ad }) => !competitors || matchCompetitor(ad, competitors) !== null);
  const untrackedCount = (ads?.length ?? 0) - visibleAds.length;
  const brandCount = new Set(visibleAds.map(({ ad }) => ad.brandDomain || ad.brand)).size;
  // BrandSearch media links expire 3 days after the fetch.
  const mediaExpired = now !== null && fetchedAt !== null && isFeedStale(fetchedAt, now);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spy</h1>
          <p className="text-sm text-ink-500">
            The active Meta ads of the competitors you track in BrandSearch Spectre, top spenders first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && (
            <span className="text-xs text-ink-400">Last refreshed {new Date(fetchedAt).toLocaleString()}</span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => refresh()}
            disabled={refreshing || !brandSearchConfigured || !canRefresh}
            title={canRefresh
              ? "Re-fetch from BrandSearch (about 1 credit per ad)"
              : "Only creative strategists can refresh the feed"}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {!brandSearchConfigured && (
        <p className="text-xs text-red-700">BRANDSEARCH_API_KEY is not configured on the server.</p>
      )}
      {brandSearchConfigured && !competitors && (
        <p className="text-xs text-red-700">
          Couldn&apos;t load your Spectre competitor list — the cached feed is shown unfiltered.
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {status && <p className="text-xs text-sky-800">{status}</p>}
      {mediaExpired && !refreshing && (
        <p className="text-xs text-amber-800">
          BrandSearch image links expire 3 days after a fetch, so some previews may not load.
          {canRefresh
            ? " Hit Refresh to reload them."
            : " They reload automatically the next time a creative strategist opens this page."}
        </p>
      )}

      {competitors && (
        <p className="text-xs text-ink-500">
          Tracking {competitors.length} competitors: {competitors.map((c) => c.domain).join(", ")}. Add or remove
          them in BrandSearch → Swipe Files → Spectre.
        </p>
      )}

      {visibleAds.length > 0 && !refreshing && (
        <div className="text-xs text-ink-500">
          {visibleAds.length} ads from {brandCount} competitors
          {untrackedCount > 0 ? ` · ${untrackedCount} from brands no longer tracked hidden` : ""}
        </div>
      )}

      {refreshing ? (
        <GallerySkeleton />
      ) : visibleAds.length > 0 ? (
        <AdGallery
          items={visibleAds}
          sweepId={sweepId}
          onRemove={removeAd}
          onKeep={keepAd}
          isBanked={(ad) => banked.has(bankKey(ad))}
          savingKey={saving}
          bankKey={bankKey}
        />
      ) : (
        <section className="card text-sm text-ink-500">
          {canRefresh ? (
            <>
              No competitor ads cached yet. Hit <span className="font-medium text-ink-700">Refresh</span> to fetch
              them from BrandSearch.
            </>
          ) : (
            "No competitor ads cached yet — a creative strategist needs to open this page to fetch them."
          )}
        </section>
      )}
    </div>
  );
}

// ─── Masonry gallery ─────────────────────────────────────────────────────────
function AdGallery({
  items,
  sweepId,
  onRemove,
  onKeep,
  isBanked,
  savingKey,
  bankKey,
}: {
  items: { ad: SpyAd; index: number }[];
  sweepId: string | null;
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
          useIdeaHref={sweepId ? `/scripts/new?spySweepId=${encodeURIComponent(sweepId)}&spyAdIndex=${index}` : null}
          onRemove={() => onRemove(index)}
          onKeep={() => onKeep(ad)}
          banked={isBanked(ad)}
          saving={savingKey !== null && savingKey === bankKey(ad)}
        />
      ))}
    </div>
  );
}

function EvidenceBadge({ ad }: { ad: SpyAd }) {
  if (!ad.winnerEvidence) return null;
  const label = ad.winnerEvidence === "verified_winner"
    ? "verified winner"
    : ad.winnerEvidence === "probable_winner" ? "probable winner" : "observed";
  const cls = ad.winnerEvidence === "verified_winner"
    ? "bg-emerald-700 text-white"
    : ad.winnerEvidence === "probable_winner" ? "bg-amber-400 text-amber-950" : "bg-ink-200 text-ink-800";
  return (
    <span className={`absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function metric(value: unknown, prefix = ""): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? `${prefix}${Math.round(value).toLocaleString()}`
    : null;
}

function AdTile({
  ad,
  useIdeaHref,
  onRemove,
  onKeep,
  banked,
  saving,
}: {
  ad: SpyAd;
  useIdeaHref: string | null;
  onRemove: () => void;
  onKeep: () => void;
  banked: boolean;
  saving: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const href = ad.sourceUrl || ad.imageUrl;
  const img = ad.imageUrl;

  return (
    <div className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-lg border border-ink-200 bg-white transition hover:border-ink-900 hover:shadow-md">
      {/* Keep + remove. A banked tile keeps its badge visible so you can see at a
          glance what you've already taken from this feed. */}
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
              className="w-full bg-ink-100 object-cover"
            />
          )}
          {ad.mediaType === "video" && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
              ▶ video
            </span>
          )}
          {ad.platform && (
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
              {ad.platform}
            </span>
          )}
          <EvidenceBadge ad={ad} />
        </div>
        <div className="p-2.5">
          <div className="truncate text-sm font-semibold text-ink-900">{ad.brand || hostOf(href)}</div>
          {ad.caption && <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{ad.caption}</p>}
          {ad.evidenceReasons && ad.evidenceReasons.length > 0 && (
            <p className="mt-1 line-clamp-2 text-[10px] text-amber-800">{ad.evidenceReasons.join(" · ")}</p>
          )}
          {ad.evidenceMetrics && (
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-ink-500">
              {metric(ad.evidenceMetrics.euTotalSpend, "€") && <span>{metric(ad.evidenceMetrics.euTotalSpend, "€")} spend</span>}
              {metric(ad.evidenceMetrics.euTotalReach) && <span>{metric(ad.evidenceMetrics.euTotalReach)} reach</span>}
              {metric(ad.evidenceMetrics.totalActiveTimeSec) && (
                <span>{Math.floor(Number(ad.evidenceMetrics.totalActiveTimeSec) / 86_400)}d active</span>
              )}
            </div>
          )}
          {ad.transcriptUrl && <p className="mt-1 text-[10px] font-medium text-sky-700">transcript available</p>}
        </div>
      </a>
      {useIdeaHref && (
        <div className="px-2.5 pb-2.5">
          <a href={useIdeaHref} className="btn btn-primary w-full text-xs">Use this idea →</a>
        </div>
      )}
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
