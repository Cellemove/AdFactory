"use client";

import { useState } from "react";
import { scenesToTsv, type TeardownScene } from "@/lib/cellumove/corpus/teardown-scenes";

function CopyButton({ label, text, className = "btn text-xs" }: { label: string; text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (insecure context or permissions): the text stays selectable.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * Teardown's scene-by-scene script, shown here so the workbook and the script
 * live in one place — the same Timestamp / Visual / Audio / Text table the
 * strategists already work from, copyable straight into Sheets.
 */
export function TeardownScript({ scenes, rawOutput }: { scenes: TeardownScene[]; rawOutput: string | null }) {
  if (!scenes.length) {
    return rawOutput
      ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
          <span>No scene table for this one — it was analysed before the script output existed.</span>
          <CopyButton label="Copy full deconstruction" text={rawOutput} />
        </div>
      )
      : null;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">Scene-by-scene script <span className="font-normal text-ink-400">{scenes.length} scenes</span></h3>
        <div className="flex flex-wrap gap-2">
          <CopyButton label="Copy table" text={scenesToTsv(scenes)} />
          {rawOutput && <CopyButton label="Copy script + workbook" text={rawOutput} />}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-ink-100">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Visual</th>
              <th className="px-3 py-2 font-medium">Voiceover</th>
              <th className="px-3 py-2 font-medium">On-screen text &amp; effects</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene, index) => (
              <tr key={`${scene.timestamp}-${index}`} className="align-top">
                <td className="whitespace-nowrap border-t border-ink-100 px-3 py-2 font-mono text-xs tabular-nums text-ink-500">{scene.timestamp}</td>
                <td className="border-t border-ink-100 px-3 py-2 text-ink-700">{scene.visual}</td>
                <td className="border-t border-ink-100 px-3 py-2 text-ink-900">{scene.audio}</td>
                <td className="whitespace-pre-line border-t border-ink-100 px-3 py-2 text-xs text-ink-600">{scene.overlays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
