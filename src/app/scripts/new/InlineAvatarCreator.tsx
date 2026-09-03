"use client";

import { useState, useTransition } from "react";
import { createSubAvatar } from "@/app/actions/avatars";

export interface InlineAvatarOption {
  id: string;
  angleId: string;
  name: string;
}

type AngleOption = { id: string; slug: string; name: string };

interface Props {
  // An avatar cannot exist without an angle, so the picker lives here — this is
  // the only place in the create flow that still asks for one.
  angles: AngleOption[];
  defaultAngleId?: string;
  onCreated: (avatar: InlineAvatarOption) => void;
}

export function InlineAvatarCreator({ angles, defaultAngleId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [angleId, setAngleId] = useState(defaultAngleId ?? angles[0]?.id ?? "");
  const [name, setName] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const angle = angles.find((item) => item.id === angleId) ?? null;

  const close = () => {
    if (pending) return;
    setOpen(false);
    setName("");
    setShortDesc("");
    setError(null);
  };

  // Reopening picks up whichever angle the form is on now, not the one left
  // over from the last time this was opened.
  const openCreator = () => {
    setAngleId(defaultAngleId ?? angles[0]?.id ?? "");
    setOpen(true);
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
        disabled={angles.length === 0}
        aria-expanded="false"
        onClick={openCreator}
      >
        + Create an avatar
      </button>
    );
  }

  return (
    <div id="inline-avatar-creator" className="mt-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">New avatar</p>
          <p className="text-xs text-ink-500">Deeper research can be added later.</p>
        </div>
        <button type="button" className="text-xs text-ink-500 hover:text-ink-900" disabled={pending} onClick={close}>Close</button>
      </div>
      <div className="mt-3 space-y-2">
        <div>
          <label className="label" htmlFor="inline-avatar-angle">Angle</label>
          <select
            id="inline-avatar-angle"
            className="input"
            value={angleId}
            disabled={pending}
            onChange={(event) => setAngleId(event.currentTarget.value)}
          >
            {angles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
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
        <button type="button" className="btn btn-primary" disabled={pending || !angle || name.trim().length < 2} onClick={create}>
          {pending ? "Creating…" : "Create and select"}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={close}>Cancel</button>
      </div>
    </div>
  );
}
