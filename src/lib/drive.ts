// Google Drive access for b-roll indexing. Reuses the SAME service account the app
// already uses for Vertex (GOOGLE_APPLICATION_CREDENTIALS_JSON) — the team just
// shares their b-roll folder with the SA's client_email. No new dependency: we mint
// the OAuth token with the SA's JWT-bearer flow using node:crypto, then hit the
// Drive REST API. Server-only.
import "server-only";
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ServiceAccount>;
    if (p.client_email && p.private_key) return { client_email: p.client_email, private_key: p.private_key };
  } catch {
    /* fall through */
  }
  return null;
}

function brollFolderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_BROLL_FOLDER_ID ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The service-account email the team must share their b-roll folder with (for setup UI). */
export function driveServiceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

export function driveConfigured(): boolean {
  return Boolean(loadServiceAccount() && brollFolderIds().length);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const sa = loadServiceAccount();
  if (!sa) throw new Error("Google Drive not configured — set GOOGLE_APPLICATION_CREDENTIALS_JSON (service account).");
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive auth failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Drive auth returned no access token.");
  cachedToken = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  description?: string;
  size?: string;
  videoMediaMetadata?: { durationMillis?: string };
}

async function listChildren(token: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields:
        "nextPageToken,files(id,name,mimeType,webViewLink,thumbnailLink,description,size,videoMediaMetadata(durationMillis))",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Drive list failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

export interface DriveClip {
  driveId: string;
  name: string;
  mimeType: string;
  folderPath: string;
  webViewLink: string | null;
  thumbnailLink: string | null;
  description: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
}

/**
 * Fresh thumbnail URL for a Drive file (video poster frame). Drive's thumbnailLink
 * expires after a few hours, so we mint one on demand instead of trusting the DB copy.
 */
export async function getDriveThumbnailUrl(driveId: string, size = 480): Promise<string | null> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?fields=thumbnailLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const { thumbnailLink } = (await res.json()) as { thumbnailLink?: string };
  if (!thumbnailLink) return null;
  // thumbnailLink ends with a size directive like "=s220" — ask for a bigger frame.
  return thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, `=s${size}`);
}

/** Download a Drive file's bytes (for Gemini clip analysis). Caller must size-gate first. */
export async function downloadDriveFile(driveId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Drive download failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function getFolderName(token: string, id: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { name?: string }).name ?? null;
}

/** Walk the configured b-roll folder tree(s) (BFS) and return every video clip. */
export async function listBrollFromDrive(): Promise<DriveClip[]> {
  const rootIds = brollFolderIds();
  if (!rootIds.length)
    throw new Error("GOOGLE_DRIVE_BROLL_FOLDER_ID is not set (comma-separated shared b-roll folder ids).");
  const token = await getAccessToken();

  const clips: DriveClip[] = [];
  // With a single root, paths stay relative to it (as before). With several roots,
  // each tree is prefixed with its root folder's name so clips stay distinguishable.
  const queue: Array<{ id: string; path: string }> = [];
  for (const id of rootIds) {
    const path = rootIds.length > 1 ? ((await getFolderName(token, id)) ?? id.slice(0, 8)) : "";
    queue.push({ id, path });
  }
  const seen = new Set<string>();
  let foldersWalked = 0;
  const MAX_FOLDERS = 2000;
  const CONCURRENCY = 8; // the libraries span hundreds of folders — serial listing would take minutes

  while (queue.length && foldersWalked < MAX_FOLDERS) {
    const wave: Array<{ id: string; path: string }> = [];
    while (queue.length && wave.length < Math.min(CONCURRENCY, MAX_FOLDERS - foldersWalked)) {
      const item = queue.shift();
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      foldersWalked++;
      wave.push(item);
    }
    if (!wave.length) continue;

    const results = await Promise.all(
      wave.map(async (item) => ({ item, children: await listChildren(token, item.id) })),
    );
    for (const { item, children } of results) {
      for (const f of children) {
        if (f.mimeType === FOLDER_MIME) {
          queue.push({ id: f.id, path: item.path ? `${item.path}/${f.name}` : f.name });
        } else if (f.mimeType.startsWith("video/")) {
          clips.push({
            driveId: f.id,
            name: f.name,
            mimeType: f.mimeType,
            folderPath: item.path,
            webViewLink: f.webViewLink ?? null,
            thumbnailLink: f.thumbnailLink ?? null,
            description: f.description ?? null,
            durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : null,
            sizeBytes: f.size ? Number(f.size) : null,
          });
        }
      }
    }
  }
  return clips;
}
