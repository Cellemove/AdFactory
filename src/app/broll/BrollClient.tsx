"use client";

import { useMemo, useState, useTransition } from "react";
import { syncBroll, analyzeBroll, markClipUsed } from "../actions/broll";

interface ClipLite {
  id: string;
  driveId: string;
  hasThumb: boolean;
  name: string;
  folderPath: string | null;
  durationMs: number | null;
  webViewLink: string | null;
  indexedAt: string;
  aiDescription: string | null;
  tags: string | null;
  analyzedAt: string | null;
  timesSuggested: number;
  timesUsed: number;
}

type SortKey = "analyzed" | "folder" | "most-suggested" | "least-suggested" | "most-used";

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
  const [sort, setSort] = useState<SortKey>("analyzed");
  const [usedBump, setUsedBump] = useState<Record<string, number>>({});
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const analyze = () => {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await analyzeBroll(5);
        setNotice(
          `Analyzed ${r.analyzed} clip${r.analyzed === 1 ? "" : "s"}` +
            (r.skipped ? `, ${r.skipped} skipped (too large)` : "") +
            (r.failed ? `, ${r.failed} failed${r.lastError ? ` (${r.lastError.slice(0, 120)})` : ""}` : "") +
            ` · ${r.remaining} still to analyze. Click again to continue.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const markUsed = (clipId: string) => {
    setError(null);
    start(async () => {
      try {
        const r = await markClipUsed(clipId);
        setUsedBump((m) => ({ ...m, [clipId]: r.timesUsed }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const analyzedCount = useMemo(() => clips.filter((c) => c.analyzedAt).length, [clips]);
  const suggestedTotal = useMemo(() => clips.reduce((n, c) => n + c.timesSuggested, 0), [clips]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? clips.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.folderPath ?? "").toLowerCase().includes(q) ||
            (c.aiDescription ?? "").toLowerCase().includes(q) ||
            (c.tags ?? "").toLowerCase().includes(q),
        )
      : [...clips];
    if (sort === "analyzed")
      // Stable sort: analyzed clips first, folder order preserved within each group.
      list.sort((a, b) => Number(Boolean(b.analyzedAt)) - Number(Boolean(a.analyzedAt)));
    else if (sort === "most-suggested") list.sort((a, b) => b.timesSuggested - a.timesSuggested);
    else if (sort === "least-suggested") list.sort((a, b) => a.timesSuggested - b.timesSuggested);
    else if (sort === "most-used") list.sort((a, b) => b.timesUsed - a.timesUsed);
    return list;
  }, [clips, query, sort]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">B-roll library</h1>
          <p className="text-sm text-ink-500">
            Indexed from Google Drive. The pipeline suggests these real clips, we count every suggestion
            &amp; use to avoid over-using footage, and Gemini describes what&apos;s in each clip.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={analyze} disabled={busy || !configured || clips.length === 0}>
            {busy ? "Working…" : "Analyze clips (AI)"}
          </button>
          <button className="btn btn-primary" onClick={sync} disabled={busy || !configured}>
            {busy ? "Working…" : "Sync from Drive"}
          </button>
        </div>
      </header>

      {clips.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-ink-500">
          <span>
            <span className="font-semibold text-ink-900">{clips.length}</span> clips indexed
          </span>
          <span>
            <span className="font-semibold text-ink-900">{analyzedCount}</span> analyzed by AI
          </span>
          <span>
            <span className="font-semibold text-ink-900">{suggestedTotal}</span> suggestions recorded
          </span>
        </div>
      )}

      {notice && <div className="card border-emerald-300 bg-emerald-50 text-sm text-emerald-900">{notice}</div>}
      {error && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{error}</div>}

      {!configured && (
        <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <div className="font-semibold">Connect your Drive to enable b-roll matching</div>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Run <code className="font-mono">migrations/007_broll_clips.sql</code> and{" "}
              <code className="font-mono">migrations/008_broll_intelligence.sql</code> in Supabase.
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
              Set <code className="font-mono">GOOGLE_DRIVE_BROLL_FOLDER_ID</code> to that folder&apos;s id
              (comma-separate several folders) {folderIdSet ? "✓ (set)" : "— currently unset"} and restart.
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              className="input h-9 max-w-sm"
              placeholder="Search name, folder, description, tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <select
                className="input h-9 w-auto text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="analyzed">Analyzed first</option>
                <option value="folder">By folder</option>
                <option value="most-suggested">Most suggested</option>
                <option value="least-suggested">Least suggested</option>
                <option value="most-used">Most used</option>
              </select>
              <span className="text-xs text-ink-500">
                {filtered.length} of {clips.length} clips
              </span>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((c) => {
              const used = usedBump[c.id] ?? c.timesUsed;
              return (
                <li key={c.id} className="card">
                  {/* First frame from Drive's generated video poster. Lazy so only
                      visible cards hit the thumb proxy. Clips Drive has no preview
                      for (big files, unprocessed uploads) get a placeholder without
                      wasting a request; transient load failures fall back the same way. */}
                  {c.hasThumb && !thumbFailed[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/broll-thumb/${c.driveId}`}
                      alt=""
                      loading="lazy"
                      className="mb-2 aspect-[9/16] w-full rounded-lg bg-ink-900/90 object-contain"
                      onError={() => setThumbFailed((m) => ({ ...m, [c.id]: true }))}
                    />
                  ) : (
                    <div
                      className="mb-2 flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-ink-900/90 text-3xl"
                      title="Drive hasn't generated a preview for this clip yet"
                    >
                      🎞️
                    </div>
                  )}
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

                  {c.aiDescription && (
                    <div
                      className="mt-1.5 cursor-pointer"
                      onClick={() => setExpanded((m) => ({ ...m, [c.id]: !m[c.id] }))}
                      title={expanded[c.id] ? "Collapse analysis" : "Expand analysis"}
                    >
                      <p className={`text-xs text-ink-600 ${expanded[c.id] ? "" : "line-clamp-2"}`}>
                        {c.aiDescription}
                      </p>
                      {c.tags &&
                        (expanded[c.id] ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.tags.split(/,\s*/).map((t) => (
                              <span key={t} className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-600">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 truncate text-[11px] text-ink-400">{c.tags}</p>
                        ))}
                      <span className="mt-1 inline-block text-[10px] text-ink-400 underline underline-offset-2">
                        {expanded[c.id] ? "▴ less" : "▾ full analysis"}
                      </span>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {c.timesSuggested > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          c.timesSuggested >= 3
                            ? "bg-amber-100 text-amber-900"
                            : "bg-ink-100 text-ink-600"
                        }`}
                        title="Times the pipeline suggested this clip"
                      >
                        suggested {c.timesSuggested}×
                      </span>
                    )}
                    {used > 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900" title="Times used in a shipped ad">
                        used {used}×
                      </span>
                    )}
                    {c.analyzedAt ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900" title="Gemini has watched this clip and written its description">
                        analyzed
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink-50 px-2 py-0.5 text-ink-400">not analyzed</span>
                    )}
                    <span className="grow" />
                    <button
                      className="rounded-full px-2 py-0.5 text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline disabled:opacity-50"
                      onClick={() => markUsed(c.id)}
                      disabled={busy}
                      title="Count this clip as used in a shipped ad"
                    >
                      + used in ad
                    </button>
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
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
