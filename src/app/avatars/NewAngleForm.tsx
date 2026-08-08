"use client";

import { useState, useTransition } from "react";
import { createAngle } from "../actions/angles";

const EMPTY = {
  name: "",
  requiredKeyword: "",
  mechanism: "",
  bannedMechanism: "",
};

export function NewAngleForm() {
  const [open, setOpen] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  const reset = () => {
    setForm(EMPTY);
    setError(null);
  };

  const submit = () => {
    setError(null);
    startSaveTransition(async () => {
      try {
        await createAngle({
          name: form.name,
          requiredKeyword: form.requiredKeyword || form.name.toLowerCase(),
          mechanism: form.mechanism,
          bannedMechanism: form.bannedMechanism || undefined,
        });
        reset();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>+ New angle</button>
    );
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-sm font-semibold">New angle</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Add a custom angle for a new product or positioning. The engine will use the mechanism + required keyword
          when generating prompts for this angle.
        </p>
      </div>
      <div className="grid-fields">
        <div className="sm:col-span-2">
          <label className="label">Name</label>
          <input
            className="input"
            placeholder='e.g. "Knee Pain Relief"'
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Required keyword</label>
          <input
            className="input"
            placeholder='e.g. "knee" (must appear in every prompt)'
            value={form.requiredKeyword}
            onChange={(e) => setForm({ ...form, requiredKeyword: e.target.value })}
          />
          <p className="mt-1 text-xs text-ink-500">If blank, defaults to the angle name.</p>
        </div>
        <div>
          <label className="label">Banned mechanisms (optional)</label>
          <input
            className="input"
            placeholder='e.g. "back pain|hip pain" (pipe-separated)'
            value={form.bannedMechanism}
            onChange={(e) => setForm({ ...form, bannedMechanism: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Mechanism</label>
          <textarea
            className="input min-h-[80px]"
            placeholder="What the angle is selling — what physiological / emotional / situational mechanism the product addresses for this angle. The engine uses this as the central anchor for every prompt."
            value={form.mechanism}
            onChange={(e) => setForm({ ...form, mechanism: e.target.value })}
          />
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving || !form.name || !form.mechanism}
        >
          {isSaving ? "Saving…" : "Save angle"}
        </button>
        <button className="btn" onClick={() => { setOpen(false); reset(); }} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
