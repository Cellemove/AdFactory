"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSubAvatar } from "../actions/avatars";

interface Props {
  angles: Array<{ slug: string; name: string }>;
  preselectedAngle?: string;
  openByDefault?: boolean;
}

export function NewSubAvatarForm({ angles, preselectedAngle, openByDefault }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(openByDefault));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    angleSlug: preselectedAngle ?? angles[0]?.slug ?? "",
    name: "",
    shortDesc: "",
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + New sub-avatar
      </button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createSubAvatar({
          angleSlug: form.angleSlug,
          name: form.name,
          shortDesc: form.shortDesc || null,
        });
        router.push(`/avatars/${created.slug}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="card">
      <h2 className="text-sm font-semibold">New sub-avatar</h2>
      <div className="divider" />
      <div className="grid-fields">
        <div>
          <label className="label">Angle</label>
          <select
            className="input"
            value={form.angleSlug}
            onChange={(e) => setForm((f) => ({ ...f, angleSlug: e.target.value }))}
          >
            {angles.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            placeholder="e.g. Post-pregnancy mom 30-40"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="label">Short description (optional)</label>
        <input
          className="input"
          placeholder="2 lines of context — feels lazy on the page without it"
          value={form.shortDesc}
          onChange={(e) => setForm((f) => ({ ...f, shortDesc: e.target.value }))}
        />
      </div>
      {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      <div className="mt-4 flex items-center gap-2">
        <button className="btn btn-primary" onClick={submit} disabled={isPending || !form.name}>
          {isPending ? "Saving…" : "Create"}
        </button>
        <button className="btn" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
