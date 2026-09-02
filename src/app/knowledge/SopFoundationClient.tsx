"use client";

import { useRef, useState, useTransition } from "react";
import {
  upsertSop,
  deleteSop,
  importSopsFromPdf,
  upsertReferenceFormat,
  deleteReferenceFormat,
  upsertMarketProfile,
  deleteMarketProfile,
} from "../actions/sops";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

// ─── Types mirrored from the server rows (only the fields the UI needs) ──────

interface Sop {
  id: string; slug: string; type: string; title: string; body: string;
  payload: string | null; roleScope: string; marketScope: string | null;
  pinned: boolean; order: number;
}
interface Format {
  id: string; slug: string; name: string; description: string; beats: string;
  bestForAngle: string | null; optimalDurationSec: number | null;
  exampleScripts: string | null; order: number;
}
interface Market {
  id: string; code: string; name: string; tone: string; vocabulary: string | null;
  hooksThatWork: string | null; hooksThatFlop: string | null; allowedClaims: string | null;
  forbiddenClaims: string | null; disclaimerClaims: string | null;
  trustpilotScore: string | null; culturalNotes: string | null; order: number;
}

const SOP_TYPES = [
  "verbatim_classification", "source_weighting", "hook_taxonomy", "hook_rules_market",
  "deep_dive_template", "reference_format", "compliance", "block_taxonomy", "naming", "other",
  "role_prompt",
];
const ROLE_SCOPES = ["all", "strategist", "copywriter", "researcher", "designer", "compliance"];

type Tab = "sops" | "formats" | "markets";

export function SopFoundationClient({
  sops, formats, markets,
}: { sops: Sop[]; formats: Format[]; markets: Market[] }) {
  const [tab, setTab] = useState<Tab>("sops");

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1 border-b border-ink-200">
        {(["sops", "formats", "markets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition ${
              tab === t ? "border-ink-900 font-semibold" : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {t === "sops" ? `SOPs (${sops.length})` : t === "formats" ? `Reference formats (${formats.length})` : `Markets (${markets.length})`}
          </button>
        ))}
      </div>

      {tab === "sops" && <SopsTab sops={sops} />}
      {tab === "formats" && <FormatsTab formats={formats} />}
      {tab === "markets" && <MarketsTab markets={markets} />}
    </section>
  );
}

function useErr() {
  const [error, setError] = useState<string | null>(null);
  const wrap = (fn: () => Promise<void>) => async () => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return { error, setError, wrap };
}

// ─── SOPs ────────────────────────────────────────────────────────────────────

const EMPTY_SOP = { id: "", type: "other", title: "", body: "", payload: "", roleScope: "all", marketScope: "", pinned: false };

function SopsTab({ sops }: { sops: Sop[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_SOP);
  const [isPending, startTransition] = useTransition();
  const { error, setError } = useErr();

  // PDF import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onPickPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg(null);
    if (file.size > MAX_PDF_BYTES) {
      setImportMsg({ ok: false, text: "PDF too large (max 10MB)." });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImporting(true);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await importSopsFromPdf(fd);
        const names = res.created.map((c) => c.title).join(", ");
        setImportMsg({ ok: true, text: `Imported ${res.created.length} SOP${res.created.length === 1 ? "" : "s"}: ${names}` });
      } catch (err) {
        setImportMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        setImporting(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const start = (s?: Sop) => {
    setError(null);
    setForm(s
      ? { id: s.id, type: s.type, title: s.title, body: s.body, payload: s.payload ?? "", roleScope: s.roleScope, marketScope: s.marketScope ?? "", pinned: s.pinned }
      : EMPTY_SOP);
    setOpen(true);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await upsertSop({
          id: form.id || undefined,
          type: form.type,
          title: form.title,
          body: form.body,
          payload: form.payload.trim() || null,
          roleScope: form.roleScope,
          marketScope: form.marketScope.trim() || null,
          pinned: form.pinned,
        });
        setOpen(false);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this SOP?")) return;
    startTransition(async () => {
      try { await deleteSop(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink-500">The procedures the agents read. Body is injected verbatim into the matching role&apos;s system prompt; use Payload for structured (JSON) SOPs like a taxonomy.</p>
        <div className="flex shrink-0 items-center gap-2">
          <a href="/sop-template.html" target="_blank" rel="noreferrer" className="btn btn-ghost text-xs">
            PDF template
          </a>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPickPdf} />
          <button className="btn" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? "Reading PDF…" : "Import PDF"}
          </button>
          <button className="btn btn-primary" onClick={() => start()}>+ New SOP</button>
        </div>
      </div>
      {importMsg && (
        <div className={`card text-sm ${importMsg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}>
          {importMsg.text}
        </div>
      )}

      {open && (
        <div className="card space-y-3">
          <div className="grid-fields">
            <div>
              <label className="label">Title</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {SOP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Role scope (which agent reads it)</label>
              <select className="input" value={form.roleScope} onChange={(e) => setForm({ ...form, roleScope: e.target.value })}>
                {ROLE_SCOPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Market scope (blank = global)</label>
              <input className="input" placeholder="e.g. de" value={form.marketScope} onChange={(e) => setForm({ ...form, marketScope: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Body (markdown — read verbatim by the agent)</label>
            <textarea className="input min-h-[160px] font-mono text-xs" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <div>
            <label className="label">Payload (optional JSON — for structured SOPs)</label>
            <textarea className="input min-h-[80px] font-mono text-xs" placeholder='e.g. {"categories": ["primary_pain", "desire", ...]}' value={form.payload} onChange={(e) => setForm({ ...form, payload: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
            Pin
          </label>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={isPending || !form.title} onClick={submit}>
              {isPending ? "Saving…" : form.id ? "Update" : "Create"}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {sops.length === 0 ? (
        <div className="card text-sm text-ink-500">No SOPs yet. Write your first one — start with the Verbatim Classification Framework (Module 1) or a Hook Taxonomy.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sops.map((s) => (
            <li key={s.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.pinned && <span className="tag tag-warn">pinned</span>}
                    <h3 className="text-sm font-semibold">{s.title}</h3>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="tag">{s.type}</span>
                    <span className="tag">{s.roleScope}</span>
                    {s.marketScope && <span className="tag">{s.marketScope}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost text-xs" onClick={() => start(s)}>edit</button>
                  <button className="btn btn-ghost text-xs text-red-700" onClick={() => remove(s.id)}>delete</button>
                </div>
              </div>
              {s.body && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-ink-600">{s.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Reference formats ───────────────────────────────────────────────────────

const EMPTY_FORMAT = { id: "", name: "", description: "", beats: "[]", bestForAngle: "", optimalDurationSec: "", exampleScripts: "" };

function FormatsTab({ formats }: { formats: Format[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORMAT);
  const [isPending, startTransition] = useTransition();
  const { error, setError } = useErr();

  const start = (f?: Format) => {
    setError(null);
    setForm(f
      ? { id: f.id, name: f.name, description: f.description, beats: f.beats || "[]", bestForAngle: f.bestForAngle ?? "", optimalDurationSec: f.optimalDurationSec != null ? String(f.optimalDurationSec) : "", exampleScripts: f.exampleScripts ?? "" }
      : EMPTY_FORMAT);
    setOpen(true);
  };

  const submit = () => {
    setError(null);
    // Validate JSON fields before sending.
    try { if (form.beats.trim()) JSON.parse(form.beats); } catch { setError("Beats must be valid JSON."); return; }
    try { if (form.exampleScripts.trim()) JSON.parse(form.exampleScripts); } catch { setError("Example scripts must be valid JSON."); return; }
    startTransition(async () => {
      try {
        await upsertReferenceFormat({
          id: form.id || undefined,
          name: form.name,
          description: form.description,
          beats: form.beats.trim() || "[]",
          bestForAngle: form.bestForAngle.trim() || null,
          optimalDurationSec: form.optimalDurationSec.trim() ? Number(form.optimalDurationSec) : null,
          exampleScripts: form.exampleScripts.trim() || null,
        });
        setOpen(false);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this reference format?")) return;
    startTransition(async () => {
      try { await deleteReferenceFormat(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">Script structures (Magic Formula, Regret Arc…). The Script Generator fills in these timed beats. Distinct from the visual Big-Swing formats.</p>
        <button className="btn btn-primary shrink-0" onClick={() => start()}>+ New format</button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div className="grid-fields">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Optimal duration (sec)</label>
              <input className="input" inputMode="numeric" value={form.optimalDurationSec} onChange={(e) => setForm({ ...form, optimalDurationSec: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label">Best for angle</label>
            <input className="input" value={form.bestForAngle} onChange={(e) => setForm({ ...form, bestForAngle: e.target.value })} />
          </div>
          <div>
            <label className="label">Beats (JSON array of {`{label, time, note}`})</label>
            <textarea className="input min-h-[140px] font-mono text-xs" value={form.beats} onChange={(e) => setForm({ ...form, beats: e.target.value })} />
          </div>
          <div>
            <label className="label">Example scripts (JSON array of strings)</label>
            <textarea className="input min-h-[80px] font-mono text-xs" value={form.exampleScripts} onChange={(e) => setForm({ ...form, exampleScripts: e.target.value })} />
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={isPending || !form.name} onClick={submit}>
              {isPending ? "Saving…" : form.id ? "Update" : "Create"}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {formats.length === 0 ? (
        <div className="card text-sm text-ink-500">No reference formats yet. Run <code>npm run seed:sop</code> to load the 5 starters.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {formats.map((f) => {
            let beats: Array<{ label?: string; time?: string }> = [];
            try { beats = f.beats ? JSON.parse(f.beats) : []; } catch { /* */ }
            return (
              <li key={f.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{f.name}</h3>
                    {f.optimalDurationSec != null && <span className="text-xs text-ink-500">~{f.optimalDurationSec}s</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost text-xs" onClick={() => start(f)}>edit</button>
                    <button className="btn btn-ghost text-xs text-red-700" onClick={() => remove(f.id)}>delete</button>
                  </div>
                </div>
                {f.description && <p className="mt-1 text-xs text-ink-600">{f.description}</p>}
                {beats.length > 0 && (
                  <ol className="mt-2 space-y-0.5 text-xs text-ink-600">
                    {beats.map((b, i) => (
                      <li key={i}><span className="font-mono text-ink-400">{b.time}</span> {b.label}</li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Market profiles ─────────────────────────────────────────────────────────

const EMPTY_MARKET = {
  id: "", code: "", name: "", tone: "", vocabulary: "", hooksThatWork: "", hooksThatFlop: "",
  allowedClaims: "", forbiddenClaims: "", disclaimerClaims: "", trustpilotScore: "", culturalNotes: "",
};

function MarketsTab({ markets }: { markets: Market[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_MARKET);
  const [isPending, startTransition] = useTransition();
  const { error, setError } = useErr();

  const start = (m?: Market) => {
    setError(null);
    setForm(m
      ? {
          id: m.id, code: m.code, name: m.name, tone: m.tone,
          vocabulary: m.vocabulary ?? "", hooksThatWork: m.hooksThatWork ?? "", hooksThatFlop: m.hooksThatFlop ?? "",
          allowedClaims: m.allowedClaims ?? "", forbiddenClaims: m.forbiddenClaims ?? "", disclaimerClaims: m.disclaimerClaims ?? "",
          trustpilotScore: m.trustpilotScore ?? "", culturalNotes: m.culturalNotes ?? "",
        }
      : EMPTY_MARKET);
    setOpen(true);
  };

  const jsonFields: Array<keyof typeof EMPTY_MARKET> = ["vocabulary", "hooksThatWork", "hooksThatFlop", "allowedClaims", "forbiddenClaims", "disclaimerClaims"];

  const submit = () => {
    setError(null);
    for (const k of jsonFields) {
      const v = (form[k] as string).trim();
      if (v) { try { JSON.parse(v); } catch { setError(`${k} must be valid JSON.`); return; } }
    }
    startTransition(async () => {
      try {
        await upsertMarketProfile({
          id: form.id || undefined,
          code: form.code,
          name: form.name,
          tone: form.tone,
          vocabulary: form.vocabulary.trim() || null,
          hooksThatWork: form.hooksThatWork.trim() || null,
          hooksThatFlop: form.hooksThatFlop.trim() || null,
          allowedClaims: form.allowedClaims.trim() || null,
          forbiddenClaims: form.forbiddenClaims.trim() || null,
          disclaimerClaims: form.disclaimerClaims.trim() || null,
          trustpilotScore: form.trustpilotScore.trim() || null,
          culturalNotes: form.culturalNotes.trim() || null,
        });
        setOpen(false);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this market profile?")) return;
    startTransition(async () => {
      try { await deleteMarketProfile(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">Per-market tone + claims rules. Feeds the compliance utility and the copywriter&apos;s per-market grading pass. JSON fields take arrays of strings.</p>
        <button className="btn btn-primary shrink-0" onClick={() => start()}>+ New market</button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div className="grid-fields">
            <div>
              <label className="label">Code</label>
              <input className="input" placeholder="de" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Tone</label>
            <textarea className="input min-h-[60px]" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Vocabulary (JSON {`{favor:[], avoid:[]}`})</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.vocabulary} onChange={(e) => setForm({ ...form, vocabulary: e.target.value })} />
            </div>
            <div>
              <label className="label">Trustpilot score to highlight</label>
              <input className="input" value={form.trustpilotScore} onChange={(e) => setForm({ ...form, trustpilotScore: e.target.value })} />
            </div>
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Hooks that work (JSON array)</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.hooksThatWork} onChange={(e) => setForm({ ...form, hooksThatWork: e.target.value })} />
            </div>
            <div>
              <label className="label">Hooks that flop (JSON array)</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.hooksThatFlop} onChange={(e) => setForm({ ...form, hooksThatFlop: e.target.value })} />
            </div>
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Allowed claims (JSON array)</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.allowedClaims} onChange={(e) => setForm({ ...form, allowedClaims: e.target.value })} />
            </div>
            <div>
              <label className="label">Forbidden claims (JSON array)</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.forbiddenClaims} onChange={(e) => setForm({ ...form, forbiddenClaims: e.target.value })} />
            </div>
          </div>
          <div className="grid-fields">
            <div>
              <label className="label">Claims needing a disclaimer (JSON array)</label>
              <textarea className="input min-h-[60px] font-mono text-xs" value={form.disclaimerClaims} onChange={(e) => setForm({ ...form, disclaimerClaims: e.target.value })} />
            </div>
            <div>
              <label className="label">Cultural notes</label>
              <textarea className="input min-h-[60px]" value={form.culturalNotes} onChange={(e) => setForm({ ...form, culturalNotes: e.target.value })} />
            </div>
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={isPending || !form.code || !form.name} onClick={submit}>
              {isPending ? "Saving…" : form.id ? "Update" : "Create"}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {markets.length === 0 ? (
        <div className="card text-sm text-ink-500">No market profiles yet. Run <code>npm run seed:sop</code> to load the 11 starters.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((m) => (
            <li key={m.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{m.name} <span className="text-ink-400">· {m.code}</span></h3>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost text-xs" onClick={() => start(m)}>edit</button>
                  <button className="btn btn-ghost text-xs text-red-700" onClick={() => remove(m.id)}>delete</button>
                </div>
              </div>
              {m.tone && <p className="mt-1 text-xs text-ink-600">{m.tone}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
