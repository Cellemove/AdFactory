// Derive a YouTube thumbnail from a video URL, so video tiles still render when
// a sweep has no scraped og:image. Pure (no imports, no env) so both the Spy grid
// and the Idea Bank table can use it from the client.
//
// Distinct from lib/youtube.ts, which is the server-side Data API fetcher.

/**
 * Host check must be an exact match or a true subdomain — a plain
 * `endsWith("youtube.com")` would also accept `evilyoutube.com`, letting an
 * attacker-controlled host reach the id parsing below.
 */
function isYouTubeHost(host: string): boolean {
  return host === "youtube.com" || host.endsWith(".youtube.com");
}

/**
 * Video ids are interpolated straight into the thumbnail path, so anything that
 * isn't a plain id (`../`, a slash, a query) is rejected rather than escaped.
 */
function isValidVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,32}$/.test(id);
}

/** Thumbnail URL for a YouTube link, or null if it isn't one. */
export function youtubeThumb(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    let id: string | null = null;
    if (host === "youtu.be") {
      id = u.pathname.slice(1).split("/")[0] || null;
    } else if (isYouTubeHost(host)) {
      if (u.pathname === "/watch") {
        id = u.searchParams.get("v");
      } else {
        const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([^/?#]+)/);
        if (m) id = m[1] ?? null;
      }
    }

    return id && isValidVideoId(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}
