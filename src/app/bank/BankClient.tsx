"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteBankedAd, updateBankedAd } from "../actions/bank";
import { BANK_STATUSES, type BankStatus } from "@/lib/bank";
import { youtubeThumb } from "@/lib/video-thumb";
import type { BankedAdRow } from "@/lib/database.types";

const STATUS_META: Record<BankStatus, { label: string; className: string }> = {
  new: { label: "New", className: "tag" },
  shortlisted: { label: "Shortlisted", className: "tag tag-warn" },
  used: { label: "Used", className: "tag tag-ok" },
  archived: { label: "Archived", className: "tag tag-danger" },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function BankClient({ items, needsMigration }: { items: BankedAdRow[]; needsMigration: boolean }) {
  const [rows, setRows] = useState(items);
  const [filter, setFilter] = useState<BankStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.brand.toLowerCase().includes(q) ||
        r.hook.toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q) ||
        (r.platform ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, query]);

  // Optimistic: update locally, then persist. Roll back the row on failure.
  const patchRow = (id: string, patch: { note?: string; status?: string }) => {
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setError(null);
    startTransition(async () => {
      try {
        await updateBankedAd(id, patch);
      } catch (e) {
        setRows(before);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const removeRow = (id: string) => {
    const before = rows;
    setRows((rs) => rs.filter((r) => r.id !== id));
    setError(null);
    startTransition(async () => {
      try {
        await deleteBankedAd(id);
      } catch (e) {
        setRows(before);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (needsMigration) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Idea Bank</h1>
          <p className="text-sm text-ink-500">Competitor ads you kept from Spy sweeps.</p>
        </header>
        <section className="card">
          <h2 className="text-sm font-semibold">One setup step left</h2>
          <div className="divider" />
          <p className="text-sm text-ink-600">
            The <code>BankedAd</code> table doesn&apos;t exist yet. Run{" "}
            <code>migrations/012_banked_ads.sql</code> in the Supabase SQL editor, then reload this
            page. Spy keeps working in the meantime — saving is just disabled.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Idea Bank</h1>
          <p className="text-sm text-ink-500">
            Competitor ads you kept from Spy sweeps. Add a note on why it&apos;s worth stealing from,
            and move it through the workflow as you use it.
          </p>
        </div>
        <span className="text-xs text-ink-400">
          {rows.length} saved{rows.length > 0 ? ` · ${counts.get("shortlisted") ?? 0} shortlisted` : ""}
        </span>
      </header>

      <section className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input flex-1"
            placeholder="Search brand, hook, note or platform…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {(["all", ...BANK_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  filter === s ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"
                }`}
              >
                {s === "all" ? `All (${rows.length})` : `${STATUS_META[s].label} (${counts.get(s) ?? 0})`}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      </section>

      {rows.length === 0 ? (
        <section className="card text-sm text-ink-500">
          Nothing banked yet. Open <a href="/spy" className="font-medium text-ink-700 hover:underline">Spy</a>{" "}
          and hit <span className="font-medium text-ink-700">Save to bank</span> on any creative worth keeping.
        </section>
      ) : visible.length === 0 ? (
        <section className="card text-sm text-ink-500">No saved ads match that filter.</section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Creative</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Hook</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {visible.map((row) => (
                  <BankRow key={row.id} row={row} onPatch={patchRow} onDelete={removeRow} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BankRow({
  row,
  onPatch,
  onDelete,
}: {
  row: BankedAdRow;
  onPatch: (id: string, patch: { note?: string; status?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [note, setNote] = useState(row.note ?? "");
  const [broken, setBroken] = useState(false);
  const img = row.imageUrl || youtubeThumb(row.sourceUrl);
  const status = (STATUS_META[row.status as BankStatus] ?? STATUS_META.new).label;

  return (
    <tr className="align-top hover:bg-ink-50">
      <td className="px-4 py-3">
        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="block w-20">
          {broken || !img ? (
            <div className="flex aspect-[3/4] w-20 items-center justify-center rounded bg-ink-100 px-1 text-center text-[10px] text-ink-500">
              {hostOf(row.sourceUrl)} ↗
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt={row.hook || row.brand}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              className="w-20 rounded bg-ink-100 object-cover"
            />
          )}
        </a>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-ink-900">{row.brand || hostOf(row.sourceUrl)}</div>
        <a
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block max-w-[14rem] truncate text-[11px] text-ink-400 hover:underline"
          title={row.sourceUrl}
        >
          {hostOf(row.sourceUrl)} ↗
        </a>
      </td>
      <td className="max-w-sm px-4 py-3 text-ink-600">
        <p className="line-clamp-3">{row.hook || <span className="text-ink-400">—</span>}</p>
      </td>
      <td className="px-4 py-3 text-ink-600">
        {row.platform || "—"}
        {row.mediaType === "video" && <span className="ml-1 text-[10px] text-ink-400">▶</span>}
      </td>
      <td className="px-4 py-3">
        <textarea
          className="input min-h-[3.5rem] w-56 resize-y text-xs"
          placeholder="Why keep this?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          // Persist on blur rather than per-keystroke: one write per edit.
          onBlur={() => {
            if ((row.note ?? "") !== note) onPatch(row.id, { note });
          }}
        />
      </td>
      <td className="px-4 py-3">
        <select
          className="input w-32 text-xs"
          value={row.status}
          onChange={(e) => onPatch(row.id, { status: e.target.value })}
          aria-label={`Status for ${row.brand || "this ad"} — currently ${status}`}
        >
          {BANK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => onDelete(row.id)}
          aria-label="Remove from bank"
          title="Remove from bank"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
