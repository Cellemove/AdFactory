"use client";

import { useMemo, useState, useTransition } from "react";
import { setVerdict } from "../../actions/runs";
import { promoteToIteration } from "../../actions/iterations";
import type { GateResult } from "@/lib/cellumove/compliance";

type Verdict = "pending" | "approved" | "rejected" | "regenerate";
type Status = "pass" | "warn" | "block" | "pending";

interface Gen {
  id: string;
  index: number;
  tool: string;
  level: string;
  hook: string;
  headlineRendered: string;
  promptText: string;
  complianceStatus: Status;
  complianceNotes: GateResult[];
  verdict: Verdict;
  verdictNote: string | null;
}

export function RunDetail({
  runId, brief, generations,
}: {
  runId: string;
  brief: { angleSlug: string; parentAdName: string | null };
  generations: Gen[];
}) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [verdictFilter, setVerdictFilter] = useState<"all" | Verdict>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<Gen[]>(generations);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Prompt copied");
    } catch {
      setToast("Copy failed — clipboard blocked");
    }
    window.setTimeout(() => setToast(null), 1500);
  };

  const filtered = useMemo(
    () => items.filter(
      (g) =>
        (filter === "all" || g.complianceStatus === filter) &&
        (verdictFilter === "all" || g.verdict === verdictFilter),
    ),
    [items, filter, verdictFilter],
  );

  const counts = useMemo(() => ({
    total: items.length,
    pass: items.filter((g) => g.complianceStatus === "pass").length,
    warn: items.filter((g) => g.complianceStatus === "warn").length,
    block: items.filter((g) => g.complianceStatus === "block").length,
    approved: items.filter((g) => g.verdict === "approved").length,
    rejected: items.filter((g) => g.verdict === "rejected").length,
  }), [items]);

  const updateVerdict = (id: string, v: "approved" | "rejected" | "regenerate", note?: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await setVerdict({ generationId: id, verdict: v, note: note ?? null });
        setItems((arr) => arr.map((g) => (g.id === id ? { ...g, verdict: v, verdictNote: note ?? null } : g)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Generations ({counts.total})</h2>
        <div className="flex flex-wrap items-center gap-1">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>all</FilterPill>
          <FilterPill active={filter === "pass"} onClick={() => setFilter("pass")} tone="ok">pass {counts.pass}</FilterPill>
          <FilterPill active={filter === "warn"} onClick={() => setFilter("warn")} tone="warn">warn {counts.warn}</FilterPill>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          <FilterPill active={verdictFilter === "all"} onClick={() => setVerdictFilter("all")}>all verdicts</FilterPill>
          <FilterPill active={verdictFilter === "pending"} onClick={() => setVerdictFilter("pending")}>pending</FilterPill>
          <FilterPill active={verdictFilter === "approved"} onClick={() => setVerdictFilter("approved")} tone="ok">approved {counts.approved}</FilterPill>
          <FilterPill active={verdictFilter === "rejected"} onClick={() => setVerdictFilter("rejected")} tone="danger">rejected {counts.rejected}</FilterPill>
        </div>
      </div>

      {error && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{error}</div>}

      {filtered.length === 0 ? (
        <div className="card text-sm text-ink-500">No prompts match these filters.</div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((g) => (
            <li key={g.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="kbd">#{g.index}</span>
                    <span className="tag">{g.tool}</span>
                    <span className="tag">{g.level}</span>
                    <StatusTag status={g.complianceStatus} />
                    <VerdictTag verdict={g.verdict} />
                  </div>
                  <div className="mt-1.5 text-sm font-medium">{g.hook}</div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-700">
                    {g.headlineRendered}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button className="btn" onClick={() => copyPrompt(g.promptText)}>
                    Copy
                  </button>
                  <button className="btn" onClick={() => setOpenId(openId === g.id ? null : g.id)}>
                    {openId === g.id ? "Hide" : "Inspect"}
                  </button>
                  <button
                    className="btn"
                    disabled={isPending || g.verdict === "approved"}
                    onClick={() => updateVerdict(g.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn"
                    disabled={isPending || g.verdict === "regenerate"}
                    onClick={() => updateVerdict(g.id, "regenerate")}
                  >
                    Regenerate
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={isPending || g.verdict === "rejected"}
                    onClick={() => updateVerdict(g.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              </div>
              {openId === g.id && (
                <Inspect g={g} runId={runId} brief={brief} onPromoted={(v) => updateVerdict(g.id, v)} onCopy={copyPrompt} />
              )}
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </section>
  );
}

function FilterPill({
  active, onClick, children, tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "ok" | "warn" | "danger";
}) {
  const color = tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "danger" ? "text-red-700" : "text-ink-700";
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-xs ${active ? "border-ink-900 bg-ink-900 text-white" : `border-ink-300 bg-white ${color} hover:bg-ink-100`}`}
    >
      {children}
    </button>
  );
}

function StatusTag({ status }: { status: Status }) {
  const cls = status === "pass" ? "tag-ok" : status === "warn" ? "tag-warn" : status === "block" ? "tag-danger" : "";
  return <span className={`tag ${cls}`}>{status}</span>;
}

function VerdictTag({ verdict }: { verdict: Verdict }) {
  const cls = verdict === "approved" ? "tag-ok" : verdict === "rejected" ? "tag-danger" : verdict === "regenerate" ? "tag-warn" : "";
  return <span className={`tag ${cls}`}>{verdict}</span>;
}

function Inspect({
  g, runId, brief, onPromoted, onCopy,
}: {
  g: Gen;
  runId: string;
  brief: { angleSlug: string; parentAdName: string | null };
  onPromoted: (v: "approved" | "rejected" | "regenerate") => void;
  onCopy: (text: string) => void;
}) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  return (
    <div className="mt-3 space-y-3 border-t border-ink-200 pt-3">
      <div>
        <h3 className="label">Compliance ({g.complianceNotes.length} gates)</h3>
        <ul className="mt-1 space-y-1 text-xs">
          {g.complianceNotes.map((r, i) => (
            <li key={`${r.gate}-${i}`} className="flex items-start gap-2">
              <span className={`tag ${r.level === "pass" ? "tag-ok" : r.level === "warn" ? "tag-warn" : "tag-danger"}`}>{r.level}</span>
              <div>
                <div className="font-medium">{r.gate}</div>
                <div className="text-ink-600">{r.message}</div>
                {r.evidence && <div className="font-mono text-[11px] text-ink-500">{r.evidence}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="label">Prompt text</h3>
        <pre className="max-h-80 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-[11px] leading-relaxed">{g.promptText}</pre>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn"
          onClick={() => onCopy(g.promptText)}
        >Copy prompt</button>
        <button className="btn btn-primary" onClick={() => setPromoteOpen((o) => !o)}>
          {promoteOpen ? "Cancel promote" : "Promote → Iteration"}
        </button>
      </div>
      {promoteOpen && (
        <PromoteForm
          generationId={g.id}
          defaultAdName={brief.parentAdName ?? "untitled"}
          defaultLevel={g.level as "easy" | "medium" | "hard"}
          onDone={() => { setPromoteOpen(false); onPromoted("approved"); }}
        />
      )}
    </div>
  );
}

function PromoteForm({
  generationId, defaultAdName, defaultLevel, onDone,
}: {
  generationId: string;
  defaultAdName: string;
  defaultLevel: "easy" | "medium" | "hard";
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    iterationNumber: 1,
    level: defaultLevel,
    editor: "MO" as "MO" | "VA" | "DO",
    originalAdName: defaultAdName,
    notes: "",
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await promoteToIteration({
          generationId,
          iterationNumber: form.iterationNumber,
          level: form.level,
          editor: form.editor,
          originalAdName: form.originalAdName,
          notes: form.notes || null,
        });
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="label">IT #</label>
          <input type="number" min={1} className="input" value={form.iterationNumber} onChange={(e) => setForm({ ...form, iterationNumber: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <div>
          <label className="label">Level</label>
          <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as "easy" | "medium" | "hard" })}>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
        </div>
        <div>
          <label className="label">Editor</label>
          <select className="input" value={form.editor} onChange={(e) => setForm({ ...form, editor: e.target.value as "MO" | "VA" | "DO" })}>
            <option value="MO">MO</option>
            <option value="VA">VA</option>
            <option value="DO">DO</option>
          </select>
        </div>
        <div>
          <label className="label">Original ad name</label>
          <input className="input" value={form.originalAdName} onChange={(e) => setForm({ ...form, originalAdName: e.target.value })} />
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn btn-primary" disabled={isPending} onClick={submit}>
          {isPending ? "Saving…" : "Create iteration"}
        </button>
        <p className="text-xs text-ink-500">Name format: IT{form.iterationNumber}-{form.level}-{form.editor}-{form.originalAdName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-…</p>
      </div>
    </div>
  );
}
