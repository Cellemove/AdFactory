import Link from "next/link";
import { formatUsd } from "@/lib/cellumove/corpus/estimate";
import type { RunRow } from "../types";
import { STATUS_LABEL, StatusIcon } from "./controls";

/** The per-ad rows for whichever stage is running. Collapsed by default in the hero. */
export function AdDetailList({ rows }: { rows: RunRow[] }) {
  if (!rows.length) return <p className="py-3 text-sm text-ink-500">No ads in this step.</p>;
  return (
    <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 bg-white">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`grid grid-cols-[1.25rem_minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm transition-colors ${row.status === "running" ? "bg-brand-blush/40" : ""}`}
        >
          <StatusIcon status={row.status} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink-900">{row.brandName}</div>
            <Link href={`/miner/${row.id}`} className="block truncate font-mono text-[11px] text-ink-400 hover:text-ink-700 hover:underline">{row.id}</Link>
          </div>
          <div
            className={`min-w-0 truncate text-xs ${row.status === "failed" ? "text-red-700" : row.status === "quarantined" ? "text-amber-800" : "text-ink-500"}`}
            title={row.detail}
          >
            {row.detail ?? STATUS_LABEL[row.status]}
          </div>
          <div className="text-right text-xs tabular-nums text-ink-400">{row.costUsd ? formatUsd(row.costUsd) : null}</div>
        </li>
      ))}
    </ul>
  );
}
