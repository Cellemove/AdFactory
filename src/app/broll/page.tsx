import { listBrollClips } from "../actions/broll";
import { driveConfigured, driveServiceAccountEmail } from "@/lib/drive";
import { BrollClient } from "./BrollClient";

export const dynamic = "force-dynamic";
// The Drive walk spans hundreds of folders; give the sync action room beyond the
// default serverless timeout.
export const maxDuration = 60;
export const metadata = { title: "B-roll · AdFactory" };

export default async function BrollPage() {
  const clips = await listBrollClips(10000);
  return (
    <BrollClient
      configured={driveConfigured()}
      serviceAccountEmail={driveServiceAccountEmail()}
      folderIdSet={Boolean(process.env.GOOGLE_DRIVE_BROLL_FOLDER_ID?.trim())}
      clips={clips.map((c) => ({
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
