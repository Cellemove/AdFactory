"use client";

function put(url: string, body: Blob | null, range: string, progress?: (loaded: number) => void): Promise<{ status: number; range: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url); xhr.timeout = 180_000;
    xhr.setRequestHeader("Content-Range", range);
    xhr.upload.onprogress = event => progress?.(event.loaded);
    xhr.onerror = () => reject(new Error("Upload interrupted. Reselect the same file and resume."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Reselect the same file and resume."));
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.send(body);
  });
}
export function uploadedOffset(range: string | null): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error("The upload returned an invalid byte range.");
  return Number(match[1]) + 1;
}
export async function uploadReferenceVideo(id: string, file: File, ticket: () => Promise<{ upload_url: string }>, onProgress: (value: number) => void): Promise<void> {
  const key = `reference-upload-${id}`;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, "0")).join("");
  const stored = sessionStorage.getItem(key);
  let session = stored ? JSON.parse(stored) as { url: string; digest: string } : null;
  if (session && session.digest !== digest) throw new Error("This is a different video. Reselect the original file to resume.");
  if (!session) { session = { url: (await ticket()).upload_url, digest }; sessionStorage.setItem(key, JSON.stringify(session)); }
  let state = await put(session.url, null, `bytes */${file.size}`);
  if ([404, 410].includes(state.status)) {
    session = { url: (await ticket()).upload_url, digest }; sessionStorage.setItem(key, JSON.stringify(session));
    state = await put(session.url, null, `bytes */${file.size}`);
  }
  if ([200, 201].includes(state.status)) { onProgress(100); return; }
  if (state.status !== 308) throw new Error(`Could not resume upload (${state.status}). Check the upload connection.`);
  let offset = uploadedOffset(state.range);
  while (offset < file.size) {
    const end = Math.min(offset + 8 * 1024 * 1024, file.size);
    const result = await put(session.url, file.slice(offset, end), `bytes ${offset}-${end - 1}/${file.size}`, loaded => onProgress(100 * (offset + loaded) / file.size));
    if ([200, 201].includes(result.status)) { onProgress(100); return; }
    if (result.status !== 308) throw new Error(`Upload interrupted (${result.status}). Resume to continue.`);
    const next = uploadedOffset(result.range);
    if (next <= offset || next > file.size) throw new Error("Upload progress could not be verified. Check storage CORS exposes Range, then resume.");
    offset = next;
  }
  throw new Error("Storage did not confirm upload completion. Resume to verify.");
}
