// WINNERS — which competitor ads form the corpus. The client's brief: about
// 100 winning ads, spread across every tracked competitor, are enough to learn
// tone and voice. BrandSearch's "Winning creative" badge is not in its API, so
// the rule rebuilds the signal behind it: brands switch losing creatives off
// within days, so a video still running weeks after launch — highest spend
// first — is a winner. Pure: the fetching lives in winners.server.ts.

export const WINNER_RULE_VERSION = "winners-v1";
export const WINNER_DEFAULT_TARGET = 100;
export const WINNER_DEFAULT_MIN_DAYS = 21;

export function winnerRuleLabel(minDays: number): string {
  return `Video still running ${minDays}+ days after launch, highest EU spend first, spread evenly across competitors`;
}

/** Latest launch date that still counts: today minus minDays, as YYYY-MM-DD (UTC). */
export function winnerCutoff(now: number, minDays: number): string {
  return new Date(now - minDays * 86_400_000).toISOString().slice(0, 10);
}

/** Each competitor's even share of the target. */
export function fairShare(target: number, brands: number): number {
  return brands > 0 ? Math.max(1, Math.ceil(target / brands)) : 0;
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
