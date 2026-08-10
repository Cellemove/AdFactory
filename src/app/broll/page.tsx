import { listBrollClips } from "../actions/broll";
import { driveConfigured, driveServiceAccountEmail } from "@/lib/drive";
import { BrollClient } from "./BrollClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "B-roll · AdFactory" };

export default async function BrollPage() {
  const clips = await listBrollClips(2000);
  return (
    <BrollClient
      configured={driveConfigured()}
      serviceAccountEmail={driveServiceAccountEmail()}
      folderIdSet={Boolean(process.env.GOOGLE_DRIVE_BROLL_FOLDER_ID?.trim())}
      clips={clips.map((c) => ({
        id: c.id,
        name: c.name,
        folderPath: c.folderPath,
        durationMs: c.durationMs,
        webViewLink: c.webViewLink,
        indexedAt: c.indexedAt,
      }))}
    />
  );
}
