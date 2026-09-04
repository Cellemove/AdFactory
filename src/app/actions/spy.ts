"use server";

import { revalidatePath } from "next/cache";
import { supabase, newId } from "@/lib/db";
import { getLLM, DEFAULT_MODEL } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import { fetchThroughProxy, extractReadableText, firstMatch } from "@/lib/scraper";
import { quoteFoundIn, normalizeForMatch } from "@/lib/cellumove/verify-research";
import { exclusionBlock } from "@/lib/cellumove/novelty";
import { dedupeNovel } from "@/lib/cellumove/embeddings";
import { DEFAULT_SPY_NICHE_SLUG, getSpyNiche, type SpyNiche } from "@/lib/cellumove/spy-niches";

// ─── COMPETITOR SPY ──────────────────────────────────────────────────────────
// "Google Images, but for ads." A grounded Gemini sweep finds the trending ad
// creatives / social posts that OTHER brands in a user-selected niche (not
// CelluMove) are running right now — ads & social posts, not
// storefront pages. We then scrape each post's og:image so the creative renders —
// model-guessed image URLs mostly hotlink-block, but og:images are CDN-hosted and
// meant to be embedded. Persisted to the Research table (type: "competitor_spy"),
// and curatable via updateSpyAds() so the user can drop entries they don't want.

export interface SpyAd {
  brand: string;            // brand / advertiser name
  imageUrl: string;         // renderable creative image (og:image, or model-provided)
  sourceUrl: string;        // link to the ad / post
  caption: string;          // the hook / headline / ad copy line
  platform: string;         // Meta / Instagram / TikTok / YouTube
  mediaType: "image" | "video";
  // Anti-hallucination flags (set during enrichment; undefined on legacy rows):
  verified?: boolean;       // sourceUrl actually loaded (live, not a dead/fake link)
  contentMatch?: boolean;   // the brand or caption actually appears on that page
}

export interface SpySweep {
  id: string;               // the Research row id (use it to curate via updateSpyAds)
  ads: SpyAd[];
  niche: SpyNiche;
}

function buildSpySystemPrompt(niche: SpyNiche): string {
  return [
  `You are a DTC competitive-intelligence scout researching the ${niche.name} niche for CelluMove.`,
  `Your job: surface the most TRENDING ad creatives and social posts that OTHER brands in this niche are running RIGHT NOW. Think of the output as a visual feed of their ADVERTISING — each item is one ad/post creative we can look at.`,
  "Obey every reject rule below. Only competitors.",
  "",
  "════════════════════════════════════════════════════════════════════════",
  `THE NICHE: ${niche.name.toUpperCase()} (examples are not an allowlist)`,
  "════════════════════════════════════════════════════════════════════════",
  `Category search terms: ${niche.categoryTerms.join(", ")}.`,
  `Example brands: ${niche.brandExamples.join(", ") || "Find the active advertisers in this niche"}.`,
  "",
  "════════════════════════════════════════════════════════════════════════",
  "WHERE TO LOOK — ad creatives and social posts only (NOT brand storefronts)",
  "════════════════════════════════════════════════════════════════════════",
  `We want the actual ADS and SOCIAL POSTS, not product/store pages. Run 8+ grounded searches mixing these category terms (${niche.categoryTerms.join(", ")}) with these AD/SOCIAL sources:`,
  "  • Meta Ads Library entries (facebook.com/ads/library) — live running ads",
  "  • site:tiktok.com brand posts / Spark ads and #shapingleggings / #buttliftleggings",
  "  • site:instagram.com brand reels & sponsored posts",
  "  • site:youtube.com ad-style Shorts and video ads",
  "READ with url-context where useful to confirm the brand and the creative's copy. Point sourceUrl at the EXACT ad / post, so its preview image is the creative itself.",
  "",
  `REJECT: ${niche.rejectRules.join("; ")}. We want the brand's actual ad / social creative, not a shop page or an article.`,
  "",
  "════════════════════════════════════════════════════════════════════════",
  "OUTPUT",
  "════════════════════════════════════════════════════════════════════════",
  "Return 10-16 DISTINCT ad/post creatives (vary brands; a couple per dominant brand is fine).",
  "For each, give the brand, the EXACT source URL of the ad/post, the hook/headline/caption (quote real words where possible), the platform, whether it's an image or video, and — IF you happen to know a direct image URL for the creative — put it in imageUrl (else leave imageUrl as an empty string; we'll fetch the post's preview image ourselves).",
  "",
  "Return EXACTLY one JSON object — no prose, no markdown fences, no preamble:",
  `{
  "ads": [
    {
      "brand": "Brand name",
      "sourceUrl": "https://exact-ad-or-post-url",
      "imageUrl": "https://direct-image-if-known-else-empty-string",
      "caption": "the hook / headline / ad copy line",
      "platform": "Meta | Instagram | TikTok | YouTube",
      "mediaType": "image | video"
    }
  ]
}`,
].join("\n");
}

function parseAds(text: string): SpyAd[] {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim()) as { ads?: Partial<SpyAd>[] };
      if (Array.isArray(parsed.ads)) return parsed.ads.map(normalize);
    } catch {
      // try next candidate
    }
  }
  throw new Error("Spy response was not valid JSON with an `ads` array.");
}

function normalize(d: Partial<SpyAd>): SpyAd {
  return {
    brand: (d.brand ?? "").trim(),
    imageUrl: typeof d.imageUrl === "string" ? d.imageUrl.trim() : "",
    sourceUrl: (d.sourceUrl ?? "").trim(),
    caption: (d.caption ?? "").trim(),
    platform: (d.platform ?? "").trim(),
    mediaType: d.mediaType === "video" ? "video" : "image",
  };
}

// ─── og:image extraction ─────────────────────────────────────────────────────
// Pull the social-preview image a page declares. These URLs are CDN-hosted and
// built to be embedded, so they render in our gallery far more reliably than a
// model-guessed image URL.
function extractPreviewImage(html: string, baseUrl: string): string | null {
  const raw = firstMatch(html, [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
  ]);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtu.be" || host.endsWith("youtube.com");
  } catch {
    return false;
  }
}

// Verify a YouTube URL via the public oEmbed endpoint. It returns JSON (with the
// real thumbnail_url + title) ONLY for videos that actually exist — fake ids 404.
// So this confirms the link is real AND gives us a real thumbnail + title to
// match the claimed brand/caption against.
async function youtubeOembed(url: string): Promise<{ thumbnailUrl: string; title: string } | null> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetchThroughProxy(oembed, { accept: "application/json", timeoutMs: 8000 });
    if (res?.ok && res.body) {
      const j = JSON.parse(res.body) as { thumbnail_url?: string; title?: string };
      if (j.thumbnail_url) return { thumbnailUrl: j.thumbnail_url, title: j.title ?? "" };
    }
  } catch {
    // unverified
  }
  return null;
}

// Many sites serve "page not found" with HTTP 200 (a soft-404), which fools a
// status-only liveness check. Detect those by their tell-tale copy so they're
// flagged unverified like a real dead link.
const NOT_FOUND_MARKERS = [
  "page not found",
  "page you're looking for",
  "page you are looking for",
  "the page you requested",
  "does not exist",
  "doesn't exist",
  "no longer exists",
  "page cannot be found",
  "page can't be found",
  "no longer available",
  "404 error",
  "error 404",
  "page has been removed",
  "page may have moved",
  "caught us hanging around",
];

function looksLikeNotFound(pageNorm: string): boolean {
  return NOT_FOUND_MARKERS.some((m) => pageNorm.includes(m));
}

// True if the claimed brand or caption actually appears in the page text — cheap
// provenance check that catches captions/brands the model invented for a real URL.
function contentMatches(ad: SpyAd, pageNorm: string): boolean {
  if (!pageNorm) return false;
  const brand = ad.brand ? normalizeForMatch(ad.brand) : "";
  if (brand.length >= 3 && pageNorm.includes(brand)) return true;
  if (ad.caption && quoteFoundIn(ad.caption, pageNorm)) return true;
  return false;
}

// Single fetch per ad → liveness + preview image + content provenance. YouTube
// goes through oEmbed (definitive existence check); everything else fetches the
// page once and reuses that body for both the og:image and the content match.
async function enrichAndVerify(ad: SpyAd): Promise<SpyAd> {
  if (!ad.sourceUrl) return { ...ad, verified: false, contentMatch: false };

  if (isYouTube(ad.sourceUrl)) {
    const oe = await youtubeOembed(ad.sourceUrl);
    if (!oe) return { ...ad, verified: false, contentMatch: false };
    return {
      ...ad,
      imageUrl: ad.imageUrl || oe.thumbnailUrl,
      verified: true,
      contentMatch: contentMatches(ad, normalizeForMatch(oe.title)),
    };
  }

  try {
    const res = await fetchThroughProxy(ad.sourceUrl, { timeoutMs: 10000, accept: "text/html" });
    if (!res || !res.ok || !res.body) return { ...ad, verified: false, contentMatch: false };
    const img =
      ad.imageUrl || (res.contentType.includes("html") ? extractPreviewImage(res.body, ad.sourceUrl) : null) || "";
    const pageNorm = normalizeForMatch(extractReadableText(res.body, 60000));
    const matched = contentMatches(ad, pageNorm);
    // Soft-404: looks like a not-found page and the ad's copy isn't on it.
    const notFound = !matched && looksLikeNotFound(pageNorm);
    return { ...ad, imageUrl: img, verified: !notFound, contentMatch: matched };
  } catch {
    return { ...ad, verified: false, contentMatch: false };
  }
}

/**
 * Run a grounded sweep of trending competitor ad/social creatives, enrich each
 * with its post preview image, and persist the sweep. Returns the row id so the
 * caller can curate it via updateSpyAds().
 * `focus` optionally narrows the lens; `nicheSlug` selects the persisted category definition.
 */
export async function spyOnCompetitors(input?: { focus?: string | null; nicheSlug?: string | null }): Promise<SpySweep> {
  const focus = input?.focus?.trim() || null;
  const niche = getSpyNiche(input?.nicheSlug ?? DEFAULT_SPY_NICHE_SLUG);
  const llm = getLLM();
  // Brands/captions already surfaced in recent sweeps — so we find fresh ones.
  const recent = (
    await supabase
      .from("Research")
      .select("drafts, queryPlan")
      .eq("type", "competitor_spy")
      .order("createdAt", { ascending: false })
      .limit(5)
  ).data ?? [];
  const seenAds: string[] = [];
  for (const r of recent as { drafts: string; queryPlan?: unknown }[]) {
    try {
      const plan = typeof r.queryPlan === "string" ? JSON.parse(r.queryPlan) : r.queryPlan;
      const previousSlug = (plan as { niche?: { slug?: string } } | null)?.niche?.slug ?? DEFAULT_SPY_NICHE_SLUG;
      if (previousSlug !== niche.slug) continue;
      for (const a of JSON.parse(r.drafts) as SpyAd[]) {
        if (a?.brand || a?.caption) seenAds.push(`${a.brand}: ${a.caption}`.trim());
      }
    } catch {
      /* ignore */
    }
  }

  const userPrompt = [
    focus
      ? `FOCUS FROM USER: ${focus}`
      : `FOCUS: open sweep — the trending creatives across the whole ${niche.name} niche.`,
    "",
    "Search the web NOW. Find the most trending ad creatives / social posts competitor brands are running (ads & social — not storefront pages).",
    "Return 10-16 distinct creatives following the schema in the system prompt. Do NOT include CelluMove.",
    "Prefer brands and creatives we have NOT already surfaced (listed below). Bring fresh advertisers and new ads, not repeats of what we've already seen.",
    "Return ONLY the JSON object described in the system prompt.",
    exclusionBlock(
      "ALREADY SURFACED IN RECENT SWEEPS — PREFER DIFFERENT ONES",
      "We've already captured these brand/creative pairs — surface new advertisers or genuinely new ads:",
      seenAds,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: buildSpySystemPrompt(niche),
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  await recordUsage({
    feature: "competitor_spy",
    model: DEFAULT_MODEL,
    usage: resp.usageMetadata,
    grounded: true,
    metadata: { focus: focus ?? undefined, nicheSlug: niche.slug },
  });

  const text = resp.text ?? "";
  if (!text.trim()) throw new Error("Spy returned no text content.");
  const parsed = parseAds(text).filter((a) => a.sourceUrl || a.imageUrl);
  if (parsed.length === 0) throw new Error("Spy returned zero creatives — try again or add a focus.");

  // Novelty gate (lexical + semantic): drop creatives that repeat a brand/caption
  // from recent sweeps (or each other).
  const fresh = await dedupeNovel(parsed, seenAds, (a) => `${a.brand}: ${a.caption}`);

  // Enrich + verify (liveness + content provenance) in parallel — one fetch each.
  const ads = await Promise.all(fresh.map(enrichAndVerify));

  const id = newId();
  await supabase.from("Research").insert({
    id,
    type: "competitor_spy",
    angleSlug: null,
    focus: focus ?? null,
    drafts: JSON.stringify(ads),
    queryPlan: { niche },
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/spy");
  return { id, ads, niche };
}

/**
 * Curate a saved sweep — overwrite its creative list (e.g. after the user removes
 * entries they don't want). Persists to the same Research row.
 */
export async function updateSpyAds(id: string, ads: SpyAd[]): Promise<void> {
  if (!id) throw new Error("Missing sweep id.");
  const res = await supabase
    .from("Research")
    .update({ drafts: JSON.stringify(ads) })
    .eq("id", id)
    .eq("type", "competitor_spy");
  if (res.error) throw new Error(res.error.message);
  revalidatePath("/spy");
}
