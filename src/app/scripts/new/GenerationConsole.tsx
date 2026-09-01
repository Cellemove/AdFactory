"use client";

import { useEffect, useRef } from "react";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";

interface Props {
  open: boolean;
  running: boolean;
  events: ScriptGenerationProgressEvent[];
  error: string | null;
  onClose: () => void;
}

const LEVEL_MARK: Record<ScriptGenerationProgressEvent["level"], string> = {
  info: "·",
  success: "✓",
  warning: "!",
  error: "×",
};

const LEVEL_CLASS: Record<ScriptGenerationProgressEvent["level"], string> = {
  info: "text-slate-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  error: "text-red-300",
};

export function GenerationConsole({ open, running, events, error, onClose }: Props) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events, error]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="generation-console-title">
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1020] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3 text-slate-100">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : error ? "bg-red-400" : "bg-sky-400"}`} />
            <div>
              <h2 id="generation-console-title" className="font-mono text-sm font-semibold">Script Maker generation console</h2>
              <p className="font-mono text-[11px] text-slate-400">Real retrieval, model, validation, and persistence events</p>
            </div>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={running} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="min-h-80 flex-1 overflow-y-auto px-4 py-4 font-mono text-xs leading-6" aria-live="polite" aria-busy={running}>
          {events.map((event) => (
            <div key={`${event.timestamp}-${event.stage}-${event.message}`} className={LEVEL_CLASS[event.level]}>
              <span className="text-slate-600">{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</span>{" "}
              <span className="inline-block w-3 font-bold">{LEVEL_MARK[event.level]}</span>{" "}
              <span className="text-sky-300">[{event.stage}]</span>{" "}
              <span>{event.message}</span>
              {event.detail && <div className="pl-[8.25rem] text-slate-500">↳ {event.detail}</div>}
            </div>
          ))}
          {error && (
            <div className="mt-2 border-l-2 border-red-400 pl-3 text-red-300">
              <div>× [error] Generation stopped</div>
              <div className="text-red-200">↳ {error}</div>
            </div>
          )}
          {running && <div className="mt-2 text-emerald-300">▋</div>}
          <div ref={logEndRef} />
        </div>

        <footer className="flex items-center justify-between border-t border-slate-700 px-4 py-3 font-mono text-[11px] text-slate-400">
          <span>{events.length} events</span>
          <span>{running ? "Generation is running. Keep this tab open." : error ? "Review the final error above." : "Generation complete. Opening Script Studio…"}</span>
        </footer>
      </div>
    </div>
  );
}
