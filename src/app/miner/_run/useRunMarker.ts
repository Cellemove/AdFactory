"use client";

// A breadcrumb for an interrupted run. The tab drives the pipeline, so closing
// it stops after the ads in flight; this remembers where it got to and offers a
// Resume button. It never restarts anything on its own — silently spending money
// after an accidental reload is exactly how a one-click button loses trust.

import { useCallback, useEffect, useState } from "react";
import type { StageKey } from "./types";

const KEY = "adfactory.miner.run";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type RunMarker = { brand: string; stage: StageKey; startedAt: number; target: number; skipGate: boolean };

function read(): RunMarker | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as Partial<RunMarker>;
    if (typeof marker.brand !== "string" || typeof marker.startedAt !== "number") return null;
    if (Date.now() - marker.startedAt > MAX_AGE_MS) return null;
    return {
      brand: marker.brand,
      stage: (marker.stage ?? "media") as StageKey,
      startedAt: marker.startedAt,
      target: typeof marker.target === "number" ? marker.target : 100,
      skipGate: Boolean(marker.skipGate),
    };
  } catch {
    return null;
  }
}

export function useRunMarker(brand: string | null) {
  const [marker, setMarker] = useState<RunMarker | null>(null);

  useEffect(() => {
    const stored = read();
    setMarker(stored && (!brand || stored.brand === brand) ? stored : null);
  }, [brand]);

  const save = useCallback((next: RunMarker) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private browsing or blocked storage: the run still works, it just cannot be resumed.
    }
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing to do.
    }
    setMarker(null);
  }, []);

  return { marker, save, clear };
}
