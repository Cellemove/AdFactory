// WINNERS — which competitor ads form the corpus. One brand at a time: ~100 of
// that competitor's winning ads is enough to learn its copywriting rules,
// formats and frameworks, where ~5 would only produce anecdotes. BrandSearch's
// "Winning creative" badge is not in its API, so the rule rebuilds the signal
// behind it: brands switch losing creatives off within days, so a video still
// running weeks after launch — highest spend first — is a winner.
//
// Pure: the fetching lives in winners.server.ts.

export const WINNER_RULE_VERSION = "winners-v1";
export const WINNER_DEFAULT_TARGET = 100;
export const WINNER_DEFAULT_MIN_DAYS = 21;
export const RECENT_MIN_DAYS = 7;
export const RECENT_MAX_DAYS = 30;
export const RECENT_DAILY_CAP = 10;
export const RECENT_POOL_FACTOR = 4;

/** Inclusive UTC launch dates, matching BrandSearch's date filters. */
export function launchedWithin(startedAt: string | null, now: number, minDays: number, maxDays: number): boolean {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return false;
  // Provider timestamps omit the zone; its launch-date filters use UTC.
  const utc = /T/.test(startedAt) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(startedAt) ? `${startedAt}Z` : startedAt;
  const date = new Date(utc).toISOString().slice(0, 10);
  return date >= winnerCutoff(now, maxDays) && date <= winnerCutoff(now, minDays);
}

/** Exclude previous work, balance by brand, then interleave so a time budget stays fair. */
export function pickNew<T>(picked: Map<string, T[]>, done: Set<string>, cap: number, idOf: (item: T) => string, spend: (item: T) => number): T[] {
  const seen = new Set(done);
  const fresh = new Map([...picked].map(([brand, items]) => [brand, items.filter((item) => {
    const id = idOf(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => spend(b) - spend(a))]));
  const balanced = [...balancedTrim(fresh, Math.max(0, cap), spend).values()];
  const out: T[] = [];
  for (let index = 0; balanced.some((items) => index < items.length); index += 1) {
    for (const items of balanced) if (index < items.length) out.push(items[index]!);
  }
  return out;
}

// Free pre-check before paying ~$0.20 for a Teardown, from fields BrandSearch
// already returned. ponytail: fixed bounds; widen if good ads are being skipped
// (the daily job logs every skip reason). There is deliberately NO "has a
// voiceover transcript" rule: BrandSearch returns no transcript link for any of
// our stored video ads (0 of 174 on 2026-09-19), so it would block every ad.
export const TEARDOWN_MIN_SEC = 10;
export const TEARDOWN_MAX_SEC = 120;

export function teardownSkipReason(ad: { durationSec: number | null; rawPayload: { is_duplicate?: boolean | null } }): string | null {
  if (ad.rawPayload.is_duplicate === true) return "duplicate creative";
  if (ad.durationSec != null && (ad.durationSec < TEARDOWN_MIN_SEC || ad.durationSec > TEARDOWN_MAX_SEC)) return `outside ${TEARDOWN_MIN_SEC}-${TEARDOWN_MAX_SEC}s`;
  return null;
}

/** BrandSearch caps page_size at 100 rows. */
export const WINNER_MAX_PAGE_SIZE = 100;

export function winnerRuleLabel(minDays: number, brand?: string | null): string {
  return brand
    ? `${brand} videos still running ${minDays}+ days after launch, highest EU spend first`
    : `Video still running ${minDays}+ days after launch, highest EU spend first, spread evenly across competitors`;
}

/** Latest launch date that still counts: today minus minDays, as YYYY-MM-DD (UTC). */
export function winnerCutoff(now: number, minDays: number): string {
  return new Date(now - minDays * 86_400_000).toISOString().slice(0, 10);
}

/** Each competitor's even share of the target. */
export function fairShare(target: number, brands: number): number {
  return brands > 0 ? Math.max(1, Math.ceil(target / brands)) : 0;
}

/**
 * Rows to request per page. The provider caps a page at 100, and a page that
 * comes back shorter than asked marks the brand exhausted — so asking for more
 * than the cap would end a single-brand pull after the first 100 ads.
 */
export function pageSizeFor(target: number, brands: number): number {
  return Math.min(WINNER_MAX_PAGE_SIZE, fairShare(target, brands));
}

export type TrackedCompetitor = { domain: string; name: string };

/**
 * The competitors one pull covers: just the named brand, or all of them when
 * no brand is given. Matches a domain or a display name, case-insensitively.
 */
export function resolveCompetitors<T extends TrackedCompetitor>(competitors: T[], brand?: string | null): T[] {
  const wanted = brand?.trim().toLowerCase();
  if (!wanted) return competitors;
  const match = competitors.find((item) => item.domain.toLowerCase() === wanted || item.name.trim().toLowerCase() === wanted);
  if (!match) {
    throw new Error(`"${brand}" is not tracked in BrandSearch Spectre. Tracked: ${competitors.map((item) => item.domain).join(", ")}`);
  }
  return [match];
}

/** Why an ad is in the corpus, written by every pick since migration 020. */
export type WinnerPickJson = {
  ruleVersion: string;
  rule: string;
  minDays: number;
  cutoff: string;
  brand: string;
  brandRank: number;
  target: number;
  pickedAt: string;
};

export function readWinnerPick(value: unknown): WinnerPickJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pick = value as Partial<WinnerPickJson>;
  if (typeof pick.brand !== "string" || typeof pick.pickedAt !== "string") return null;
  return {
    ruleVersion: typeof pick.ruleVersion === "string" ? pick.ruleVersion : WINNER_RULE_VERSION,
    rule: typeof pick.rule === "string" ? pick.rule : "",
    minDays: typeof pick.minDays === "number" ? pick.minDays : WINNER_DEFAULT_MIN_DAYS,
    cutoff: typeof pick.cutoff === "string" ? pick.cutoff : "",
    brand: pick.brand,
    brandRank: typeof pick.brandRank === "number" ? pick.brandRank : 0,
    target: typeof pick.target === "number" ? pick.target : 0,
    pickedAt: pick.pickedAt,
  };
}

export type BrandProgress = { domain: string; fetched: number; total: number | null; exhausted: boolean };

/**
 * When the even share leaves a gap (some brands have fewer winners), the
 * brands with the most winners left fetch one more page each — just enough
 * pages to cover the gap.
 */
export function brandsToExtend(brands: BrandProgress[], shortfall: number, pageSize: number): string[] {
  if (shortfall <= 0 || pageSize <= 0) return [];
  const remaining = (brand: BrandProgress) => (brand.total == null ? Number.POSITIVE_INFINITY : brand.total - brand.fetched);
  return brands
    .filter((brand) => !brand.exhausted && remaining(brand) > 0)
    .sort((a, b) => remaining(b) - remaining(a) || a.domain.localeCompare(b.domain))
    .slice(0, Math.ceil(shortfall / pageSize))
    .map((brand) => brand.domain);
}

/**
 * Cut the pool down to `target` while keeping it balanced: repeatedly drop the
 * lowest-spend ad from whichever brand currently has the most. Each brand's
 * list must already be sorted by spend, highest first.
 */
export function balancedTrim<T>(byBrand: Map<string, T[]>, target: number, spend: (item: T) => number): Map<string, T[]> {
  const out = new Map([...byBrand].map(([brand, items]) => [brand, [...items]]));
  let total = [...out.values()].reduce((sum, items) => sum + items.length, 0);
  while (total > target) {
    let victim: string | null = null;
    for (const [brand, items] of out) {
      if (!items.length) continue;
      const current = victim ? out.get(victim)! : null;
      if (!current || items.length > current.length
        || (items.length === current.length && spend(items.at(-1)!) < spend(current.at(-1)!))) victim = brand;
    }
    if (!victim) break;
    out.get(victim)!.pop();
    total -= 1;
  }
  return out;
}
