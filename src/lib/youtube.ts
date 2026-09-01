// YouTube comment fetcher via the YouTube Data API v3 (public read — API key only;
// service-account/Vertex creds don't work with this API). Free within the daily
// quota. We pull REAL top comments so the deep dive works from actual words people
// wrote, alongside the Reddit verbatims.
//
// Set YOUTUBE_API_KEY (an API key from the SAME GCP project, restricted to the
// YouTube Data API). FAILS SOFT: no key / quota / error → "" so research continues.

const API = "https://www.googleapis.com/youtube/v3";

function apiKey(): string {
  return process.env.YOUTUBE_API_KEY?.trim() || "";
}

export function youtubeConfigured(): boolean {
  return Boolean(apiKey());
}

interface YTVideo {
  id: string;
  title: string;
  channel: string;
}
export interface YTComment {
  id: string;
  text: string;
  likes: number;
  author: string;
  publishedAt: string | null;
}
export interface YTThread {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  comments: YTComment[];
}

async function ytGet(path: string, params: Record<string, string>): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, key }).toString();
  try {
    const res = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null; // 403 = quota/key issue → fail soft
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// Minimal HTML-entity decode for titles (comments are fetched as plainText).
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function searchVideos(query: string, max = 3): Promise<YTVideo[]> {
  const json = (await ytGet("search", {
    part: "snippet",
    q: query,
    type: "video",
    order: "relevance",
    relevanceLanguage: "en",
    maxResults: String(max),
  })) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }> } | null;
  return (json?.items ?? [])
    .map((it) => ({
      id: it.id?.videoId ?? "",
      title: decode(it.snippet?.title ?? ""),
      channel: it.snippet?.channelTitle ?? "",
    }))
    .filter((v) => v.id);
}

async function topComments(videoId: string, max = 8): Promise<YTComment[]> {
  const json = (await ytGet("commentThreads", {
    part: "snippet",
    videoId,
    order: "relevance",
    textFormat: "plainText",
    maxResults: String(max),
  })) as {
    items?: Array<{
      snippet?: {
        topLevelComment?: {
          id?: string;
          snippet?: {
            textDisplay?: string;
            likeCount?: number;
            authorDisplayName?: string;
            publishedAt?: string;
          };
        };
      };
    }>;
  } | null;
  return (json?.items ?? [])
    .map((it) => {
      const top = it.snippet?.topLevelComment;
      const c = top?.snippet;
      return {
        id: top?.id ?? "",
        text: (c?.textDisplay ?? "").trim(),
        likes: c?.likeCount ?? 0,
        author: c?.authorDisplayName ?? "",
        publishedAt: c?.publishedAt ?? null,
      };
    })
    .filter((c) => c.id && c.text);
}

/**
 * Run a few YouTube searches and return STRUCTURED threads (video + real top
 * comments), so callers can both prompt with them and attach the comments to their
 * data. Bounded + fail-soft (→ []).
 */
export async function fetchYouTubeThreads(
  queries: string[],
  opts: { maxVideos?: number; maxComments?: number } = {},
): Promise<YTThread[]> {
  if (!youtubeConfigured()) return [];
  const maxVideos = opts.maxVideos ?? 5;
  const perVideo = opts.maxComments ?? 8;

  // Search across queries, dedupe videos by id.
  const seen = new Map<string, YTVideo>();
  for (const q of queries.slice(0, 4)) {
    for (const v of await searchVideos(q, 3)) if (!seen.has(v.id)) seen.set(v.id, v);
    if (seen.size >= maxVideos) break;
  }
  const videos = [...seen.values()].slice(0, maxVideos);

  const threads: YTThread[] = [];
  for (const v of videos) {
    const comments = await topComments(v.id, perVideo);
    if (comments.length === 0) continue;
    threads.push({
      videoId: v.id,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.title,
      channel: v.channel,
      comments,
    });
  }
  return threads;
}

/** Format structured YouTube threads into a prompt block (titles + top comments). */
export function formatYouTubeThreads(threads: YTThread[], maxChars = 6000): string {
  const blocks = threads.map((t) => {
    const lines = [`### YouTube — "${t.title}"${t.channel ? ` (${t.channel})` : ""}`, t.url];
    for (const c of t.comments) {
      const body = truncate(c.text.replace(/\s+/g, " ").trim(), 400);
      if (body) lines.push(`- (${c.likes}👍) ${body}`);
    }
    return lines.join("\n");
  });
  let out = blocks.join("\n\n");
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n…(truncated)";
  return out.trim();
}

/** Convenience: search + format to a prompt block in one call. Fail-soft (→ ""). */
export async function gatherYouTubeComments(
  queries: string[],
  opts: { maxVideos?: number; maxComments?: number; maxChars?: number } = {},
): Promise<string> {
  const threads = await fetchYouTubeThreads(queries, opts);
  return formatYouTubeThreads(threads, opts.maxChars);
}
