"use client";

import { useEffect, useState } from "react";

// Tailwind only ships classes it can see as literals, so the mapping is spelled out.
const ASPECT_CLASS: Record<string, string> = {
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "9:16": "aspect-[9/16]",
};

export function aspectClass(format: string): string {
  return ASPECT_CLASS[format] ?? "aspect-[4/5]";
}

export type StepState = "done" | "current" | "locked";

export function Steps({ steps }: { steps: { label: string; detail: string; state: StepState }[] }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
            step.state === "current"
              ? "border-ink-900 bg-white shadow-card"
              : step.state === "done"
                ? "border-emerald-200 bg-emerald-50/60"
                : "border-ink-200/70 bg-ink-50 opacity-70"
          }`}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              step.state === "done"
                ? "bg-emerald-600 text-white"
                : step.state === "current"
                  ? "bg-ink-900 text-white"
                  : "bg-ink-200 text-ink-500"
            }`}
          >
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink-900">{step.label}</div>
            <div className="truncate text-xs text-ink-500">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Full-size viewer. Closes on Escape, backdrop click, or the button; locks page
// scroll while open so the backdrop does not drift.
export function Lightbox({
  src,
  alt,
  onClose,
  children,
}: {
  src?: string | null;
  alt: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-pop ${src ? "max-w-5xl md:flex-row" : "max-w-md"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {src && (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-h-[50vh] w-auto object-contain md:max-h-[88vh]" referrerPolicy="no-referrer" />
          </div>
        )}
        <div className={`flex min-h-0 w-full shrink-0 flex-col ${src ? "md:w-80" : ""}`}>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
            <span className="truncate text-sm font-medium text-ink-900">{alt}</span>
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose} aria-label="Close">
              Close ✕
            </button>
          </div>
          {children && <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs text-ink-600">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// Seconds since `active` became true; resets when it goes false.
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(seconds, 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
