"use client";

import { useRef, useState, useTransition } from "react";
import { createFrameworkFromVideo } from "@/app/actions/reference-formats";
import type { ReferenceFormatBeat } from "@/lib/cellumove/reference-formats";

export interface InlineFrameworkOption {
  id: string;
  name: string;
  duration: number | null;
  extracted: true;
}

// Kept in step with MAX_UPLOAD_BYTES in framework-extraction.ts. Checked here
// too so an oversized file gets a precise message instantly instead of an
// opaque server-action body-limit error.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

type Mode = "upload" | "youtube" | "url";

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "upload", label: "Upload" },
  { value: "youtube", label: "YouTube" },
  { value: "url", label: "Ad URL" },
];

interface Props {
  onCreated: (framework: InlineFrameworkOption) => void;
}

export function InlineFrameworkExtractor({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [url, setUrl] = useState("");
  const [nameOverride, setNameOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; beats: ReferenceFormatBeat[]; leakWarning: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setUrl("");
    setNameOverride("");
    setError(null);
    setResult(null);
  };

  const extract = () => {
    setError(null);
    setResult(null);
    const file = fileRef.current?.files?.[0] ?? null;

    if (mode === "upload") {
      if (!file) {
        setError("Choose a video file first.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The upload path accepts up to ${MAX_UPLOAD_MB}MB — trim to the first ~60 seconds, or export at 720p / a lower bitrate.`,
        );
        return;
      }
    } else if (!url.trim()) {
      setError("Paste a link first.");
      return;
    }

    const formData = new FormData();
    formData.set("mode", mode);
    if (mode === "upload" && file) formData.set("video", file);
    if (mode !== "upload") formData.set("url", url.trim());
    if (nameOverride.trim()) formData.set("nameOverride", nameOverride.trim());

    startTransition(async () => {
      try {
        const framework = await createFrameworkFromVideo(formData);
        onCreated({ id: framework.id, name: framework.name, duration: framework.duration, extracted: true });
        // Stay open showing the beats: the "describe the structure, not this
        // ad" rule can't be verified automatically, so this is where a human
        // actually reads what was saved.
        setResult({ name: framework.name, beats: framework.beats, leakWarning: framework.leakWarning });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="mt-1 text-xs font-medium text-brand-purple hover:underline"
        aria-expanded="false"
        onClick={() => setOpen(true)}
      >
        + Copy framework from a video
      </button>
    );
  }

  return (
    <div id="inline-framework-extractor" className="mt-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Copy a framework</p>
          <p className="text-xs text-ink-500">Gemini watches the ad and saves its beat structure as a reusable framework.</p>
        </div>
        <button type="button" className="text-xs text-ink-500 hover:text-ink-900" disabled={pending} onClick={close}>Close</button>
      </div>

      {result ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink-900">
            Copied “{result.name}” — {result.beats.length} beats
          </p>
          {result.leakWarning && (
            <p className="mt-1 text-xs text-amber-800">
              “{result.leakWarning}” appears in more than one beat note — check the framework reads as reusable, not as this one ad.
            </p>
          )}
          <ol className="mt-2 space-y-1">
            {result.beats.map((beat, index) => (
              <li key={`${beat.label}-${index}`} className="text-xs text-ink-600">
                <span className="font-medium text-ink-900">{beat.label}</span>
                <span className="text-ink-400"> · {beat.time}</span>
                <span className="block">{beat.note}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={close}>Done</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setResult(null);
                setUrl("");
                setNameOverride("");
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Copy another
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Video source">
            {MODES.map((item) => (
              <label key={item.value} className={`tag cursor-pointer ${mode === item.value ? "border-violet-600 bg-violet-50" : ""}`}>
                <input
                  className="mr-1"
                  type="radio"
                  name="framework-video-mode"
                  value={item.value}
                  checked={mode === item.value}
                  disabled={pending}
                  onChange={() => { setMode(item.value); setError(null); }}
                />
                {item.label}
              </label>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            {mode === "upload" ? (
              // Keyed so switching modes remounts the field: without it React
              // reuses one DOM input for both, flipping the uncontrolled file
              // input into the controlled URL input.
              <div key="upload">
                <label className="label" htmlFor="framework-video-file">Video file</label>
                <input id="framework-video-file" ref={fileRef} className="input" type="file" accept="video/*" disabled={pending} />
                <p className="mt-1 text-xs text-ink-500">MP4, MOV, WEBM or M4V, up to {MAX_UPLOAD_MB}MB. A 60-second 720p clip is usually 4–8MB.</p>
              </div>
            ) : (
              <div key="link">
                <label className="label" htmlFor="framework-video-url">{mode === "youtube" ? "YouTube link" : "Ad link"}</label>
                <input
                  id="framework-video-url"
                  className="input"
                  type="url"
                  autoFocus
                  placeholder={mode === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://…"}
                  value={url}
                  disabled={pending}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
                <p className="mt-1 text-xs text-ink-500">
                  {mode === "youtube"
                    ? "The video must be public. Keep it under ~2 minutes."
                    : "TikTok, Instagram and Facebook links usually can't be read directly — if it fails, download the video and use Upload."}
                </p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="framework-name">Framework name <span className="font-normal text-ink-400">(optional)</span></label>
              <input
                id="framework-name"
                className="input"
                maxLength={80}
                placeholder="Leave blank to let Gemini name the structure"
                value={nameOverride}
                disabled={pending}
                onChange={(event) => setNameOverride(event.currentTarget.value)}
              />
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={extract}>
              {pending ? "Watching video…" : "Copy framework"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={close}>Cancel</button>
          </div>
          {pending && <p className="mt-2 text-xs text-ink-500">This takes 20–60 seconds — Gemini watches the whole ad.</p>}
        </>
      )}
    </div>
  );
}
