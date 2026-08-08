"use client";

import { useState, useTransition } from "react";
import { upsertResearch } from "../../actions/avatars";

type Initial = {
  painPoints: string;
  desires: string;
  objections: string;
  dailyLanguage: string;
  triggers: string;
  identity: string;
  socialProof: string;
  buyingContext: string;
  notes: string;
};

const EMPTY: Initial = {
  painPoints: "",
  desires: "",
  objections: "",
  dailyLanguage: "",
  triggers: "",
  identity: "",
  socialProof: "",
  buyingContext: "",
  notes: "",
};

const FIELDS: Array<{ key: keyof Initial; label: string; placeholder: string; rows?: number }> = [
  { key: "painPoints", label: "Pain points", placeholder: "Bulleted, one per line.", rows: 4 },
  { key: "desires", label: "Desires", placeholder: "What they want at the end of the day.", rows: 4 },
  { key: "objections", label: "Objections", placeholder: "Why they hesitate to buy.", rows: 3 },
  { key: "dailyLanguage", label: "Daily language", placeholder: "Words they actually use. Copy literally.", rows: 4 },
  { key: "triggers", label: "Triggers", placeholder: "Specific moments when the problem becomes acute.", rows: 3 },
  { key: "identity", label: "Identity", placeholder: "Who they want to BE after using the product.", rows: 3 },
  { key: "socialProof", label: "Social proof angles", placeholder: "Whose endorsement moves them.", rows: 3 },
  { key: "buyingContext", label: "Buying context", placeholder: "Device, time of day, mindset when purchasing.", rows: 3 },
];

export function ResearchForm({ subAvatarId, initial }: { subAvatarId: string; initial: Initial | null }) {
  const [form, setForm] = useState<Initial>(initial ?? EMPTY);
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await upsertResearch({ subAvatarId, ...form });
        setSavedAt(new Date().toLocaleTimeString());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Avatar research</h2>
        {savedAt && <span className="text-xs text-emerald-700">saved at {savedAt}</span>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.rows && f.rows > 3 ? "sm:col-span-2" : ""}>
            <label className="label">{f.label}</label>
            <textarea
              className="input"
              rows={f.rows ?? 3}
              placeholder={f.placeholder}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
          />
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={submit} disabled={isPending}>
          {isPending ? "Saving…" : "Save research"}
        </button>
        <p className="text-xs text-ink-500">
          Required fields: all 8. The wizard hard-blocks if any are empty.
        </p>
      </div>
    </div>
  );
}
