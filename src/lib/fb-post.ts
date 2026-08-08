// Facebook post harvester — for OUR OWN ad posts (the imported winning ads).
//
// A public FB post page exposes the ad's creative as <meta og:image> and its
// primary text as <meta og:description>. CRITICAL quirk discovered the hard way:
// FB 400-blocks requests claiming a full "Chrome/124…" User-Agent when the TLS
// fingerprint doesn't match real Chrome, but accepts a SHORT generic UA — so do
// NOT reuse the scraper's browser UA here. FB also intermittently serves a thin
// variant page, so we retry a few times.
//
// Everything fails soft-ish: callers get nulls and decide how to degrade.

const FB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const FB_HOST = /(?:^|\.)facebook\.com$/i;
const FB_CDN_HOST = /(?:^|\.)(?:fbcdn\.net|facebook\.com)$/i;

export interface FbPostContent {
  imageUrl: string | null;    // the creative (og:image) — SIGNED fbcdn URL, expires in days
  primaryText: string | null; // the ad's primary text (og:description); often absent on video posts
  pageTitle: string | null;   // og:title (the page name)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaTag(html: string, prop: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`, "i")) ||
    html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${prop}"`, "i"));
  return m?.[1]?.trim() ? decodeEntities(m[1]) : null;
}

/** True when the URL is an https facebook.com link (SSRF guard for user-stored links). */
export function isFbPostUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && FB_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Fetch a public FB post page and pull the creative + primary text from its og tags. */
export async function harvestFbPost(postUrl: string, attempts = 3): Promise<FbPostContent> {
  if (!isFbPostUrl(postUrl)) throw new Error("Not a facebook.com post URL.");
  let html = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(postUrl, {
        redirect: "follow",
        headers: { "User-Agent": FB_UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
      html = await res.text();
      if (/property="og:image"/i.test(html)) break; // got the real page
    } catch {
      // retry
    }
  }
  return {
    imageUrl: metaTag(html, "og:image"),
    primaryText: metaTag(html, "og:description"),
    pageTitle: metaTag(html, "og:title"),
  };
}

/** Download the creative from fbcdn (signed URLs expire — persist the bytes immediately). */
export async function downloadFbImage(
  imageUrl: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const host = new URL(imageUrl).hostname;
    if (!FB_CDN_HOST.test(host)) return null; // only fetch FB-owned image hosts
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": FB_UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1000) return null; // not a real image
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    return { bytes, contentType };
  } catch {
    return null;
  }
}
