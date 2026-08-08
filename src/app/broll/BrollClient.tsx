"use client";

import { useMemo, useState, useTransition } from "react";
import { syncBroll } from "../actions/broll";

interface ClipLite {
  id: string;
  name: string;
  folderPath: string | null;
  durationMs: number | null;
  webViewLink: string | null;
  indexedAt: string;
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function BrollClient({
  configured,
  serviceAccountEmail,
  folderIdSet,
  clips,
}: {
  configured: boolean;
  serviceAccountEmail: string | null;
  folderIdSet: boolean;
  clips: ClipLite[];
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const sync = () => {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await syncBroll();
        setNotice(`Synced: ${r.added} added, ${r.updated} updated, ${r.removed} removed · ${r.total} clips total.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.folderPath ?? "").toLowerCase().includes(q),
    );
  }, [clips, query]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">B-roll library</h1>
          <p className="text-sm text-ink-500">
            Indexed from your Google Drive. The Designer &amp; Creative-Briefs stages match script beats to these
            real clips and flag what&apos;s missing.
          </p>
        </div>
        <button className="btn btn-primary" onClick={sync} disabled={busy || !configured}>
          {busy ? "Syncing…" : "Sync from Drive"}
        </button>
      </header>

      {notice && <div className="card border-emerald-300 bg-emerald-50 text-sm text-emerald-900">{notice}</div>}
      {error && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{error}</div>}

      {!configured && (
        <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <div className="font-semibold">Connect your Drive to enable b-roll matching</div>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Run <code className="font-mono">migrations/007_broll_clips.sql</code> in Supabase.
            </li>
            <li>
              Share your b-roll Drive folder (View access) with the app&apos;s service account:{" "}
              {serviceAccountEmail ? (
                <code className="font-mono">{serviceAccountEmail}</code>
              ) : (
                <span className="italic">
                  (set <code className="font-mono">GOOGLE_APPLICATION_CREDENTIALS_JSON</code> first)
                </span>
              )}
            </li>
            <li>
              Set <code className="font-mono">GOOGLE_DRIVE_BROLL_FOLDER_ID</code> to that folder&apos;s id{" "}
              {folderIdSet ? "✓ (set)" : "— currently unset"} and restart.
            </li>
            <li>Come back and hit “Sync from Drive.”</li>
          </ol>
        </div>
      )}

      {configured && clips.length === 0 && (
        <div className="card text-sm text-ink-500">
          No clips indexed yet. Hit <span className="font-medium">Sync from Drive</span> to pull your b-roll.
        </div>
      )}

      {clips.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2">
            <input
              className="input h-9 max-w-sm"
              placeholder="Search clips by name or folder…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="text-xs text-ink-500">
              {filtered.length} of {clips.length} clips
            </span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <li key={c.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={c.name}>
                      {c.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-500" title={c.folderPath ?? ""}>
                      {c.folderPath || "—"}
                    </div>
                  </div>
                  {c.durationMs != null && <span className="tag shrink-0">{fmtDuration(c.durationMs)}</span>}
                </div>
                {c.webViewLink && (
                  <a
                    href={c.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-ink-600 underline hover:text-ink-900"
                  >
                    Open in Drive →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
