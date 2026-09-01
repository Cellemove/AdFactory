"use client";

import { useState, useTransition } from "react";
import { createSubAvatar } from "@/app/actions/avatars";

export interface InlineAvatarOption {
  id: string;
  angleId: string;
  name: string;
}

interface Props {
  angle: { id: string; slug: string; name: string } | null;
  onCreated: (avatar: InlineAvatarOption) => void;
}

export function InlineAvatarCreator({ angle, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    if (pending) return;
    setOpen(false);
    setName("");
    setShortDesc("");
    setError(null);
  };

  const create = () => {
    if (!angle || name.trim().length < 2) return;
    setError(null);
    startTransition(async () => {
      try {
        const created = await createSubAvatar({
          angleSlug: angle.slug,
          name: name.trim(),
          shortDesc: shortDesc.trim() || null,
        });
        onCreated({ id: created.id, angleId: created.angleId, name: created.name });
        close();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="mt-1 text-xs font-medium text-brand-purple hover:underline disabled:text-ink-400"
        disabled={!angle}
        aria-expanded="false"
        onClick={() => setOpen(true)}
      >
        + Create an avatar for this angle
      </button>
    );
  }

  return (
    <div id="inline-avatar-creator" className="mt-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">New avatar</p>
          <p className="text-xs text-ink-500">For {angle?.name}. Deeper research can be added later.</p>
        </div>
        <button type="button" className="text-xs text-ink-500 hover:text-ink-900" disabled={pending} onClick={close}>Close</button>
      </div>
      <div className="mt-3 space-y-2">
        <div>
          <label className="label" htmlFor="inline-avatar-name">Avatar name</label>
          <input
            id="inline-avatar-name"
            className="input"
            maxLength={80}
            autoFocus
            placeholder="e.g. Busy professional 35–45"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="inline-avatar-description">Short description <span className="font-normal text-ink-400">(optional)</span></label>
          <textarea
            id="inline-avatar-description"
            className="input min-h-20 resize-y"
            maxLength={280}
            placeholder="Who they are, what they want, and what is stopping them."
            value={shortDesc}
            onChange={(event) => setShortDesc(event.currentTarget.value)}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary" disabled={pending || name.trim().length < 2} onClick={create}>
          {pending ? "Creating…" : "Create and select"}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={close}>Cancel</button>
      </div>
    </div>
  );
}
