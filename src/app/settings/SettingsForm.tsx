"use client";

import { useState, useTransition } from "react";
import { updateSettings } from "../actions/settings";

interface Initial {
  brandWordmarkPath: string;
  referenceImagePath: string;
  defaultEditor: "MO" | "VA" | "DO";
  defaultTargetCount: number;
  allowedSkinTones: string;
}

export function SettingsForm({ initial }: { initial: Initial }) {
  const [form, setForm] = useState<Initial>(initial);
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateSettings({
          brandWordmarkPath: form.brandWordmarkPath || null,
          referenceImagePath: form.referenceImagePath || null,
          defaultEditor: form.defaultEditor,
          defaultTargetCount: form.defaultTargetCount,
          allowedSkinTones: form.allowedSkinTones,
        });
        setSavedAt(new Date().toLocaleTimeString());
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Defaults</h2>
        {savedAt && <span className="text-xs text-emerald-700">saved at {savedAt}</span>}
      </div>
      <div className="grid-fields">
        <div>
          <label className="label">Brand wordmark path</label>
          <input className="input" placeholder="/brand/wordmark.png" value={form.brandWordmarkPath} onChange={(e) => setForm({ ...form, brandWordmarkPath: e.target.value })} />
        </div>
        <div>
          <label className="label">Reference legging image path</label>
          <input className="input" placeholder="/reference/leggings.jpg" value={form.referenceImagePath} onChange={(e) => setForm({ ...form, referenceImagePath: e.target.value })} />
        </div>
        <div>
          <label className="label">Default editor</label>
          <select className="input" value={form.defaultEditor} onChange={(e) => setForm({ ...form, defaultEditor: e.target.value as "MO" | "VA" | "DO" })}>
            <option value="MO">MO</option>
            <option value="VA">VA</option>
            <option value="DO">DO</option>
          </select>
        </div>
        <div>
          <label className="label">Default target prompt count</label>
          <input
            type="number"
            className="input"
            min={1}
            max={40}
            value={form.defaultTargetCount}
            onChange={(e) => setForm({ ...form, defaultTargetCount: Math.max(1, Math.min(40, Number(e.target.value) || 25)) })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Allowed skin tones (comma-separated)</label>
          <input className="input" value={form.allowedSkinTones} onChange={(e) => setForm({ ...form, allowedSkinTones: e.target.value })} />
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2">
        <button className="btn btn-primary" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
