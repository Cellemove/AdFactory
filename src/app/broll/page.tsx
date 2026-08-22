import { searchBrollClips } from "../actions/broll";
import { driveConfigured, driveServiceAccountEmail } from "@/lib/drive";
import { BrollClient } from "./BrollClient";

export const dynamic = "force-dynamic";
// The Drive walk spans hundreds of folders; give the sync action room beyond the
// default serverless timeout.
export const maxDuration = 60;
export const metadata = { title: "B-roll · AdFactory" };

const SORTS = ["analyzed", "folder", "most-suggested", "least-suggested", "most-used"] as const;
type Sort = (typeof SORTS)[number];

export default async function BrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const sort: Sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : "analyzed";
  const page = Math.max(parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1, 1);

  const data = await searchBrollClips({ q, sort, page });

  return (
    <BrollClient
      configured={driveConfigured()}
      serviceAccountEmail={driveServiceAccountEmail()}
      folderIdSet={Boolean(process.env.GOOGLE_DRIVE_BROLL_FOLDER_ID?.trim())}
      q={q}
      sort={sort}
      page={Math.min(page, data.pageCount)}
      pageCount={data.pageCount}
      total={data.total}
      indexedTotal={data.indexedTotal}
      analyzedTotal={data.analyzedTotal}
      suggestionsTotal={data.suggestionsTotal}
      clips={data.clips.map((c) => ({
        id: c.id,
        driveId: c.driveId,
        hasThumb: Boolean(c.thumbnailLink),
        name: c.name,
        folderPath: c.folderPath,
        durationMs: c.durationMs,
        webViewLink: c.webViewLink,
        indexedAt: c.indexedAt,
        aiDescription: c.aiDescription ?? null,
        tags: c.tags ?? null,
        analyzedAt: c.analyzedAt ?? null,
        timesSuggested: c.timesSuggested ?? 0,
        timesUsed: c.timesUsed ?? 0,
      }))}
    />
  );
}
