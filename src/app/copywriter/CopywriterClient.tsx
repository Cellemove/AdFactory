"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askCopywriter, createCopySession, deleteCopySession } from "@/app/actions/copywriter";
import type { ClaimScan } from "@/lib/cellumove/claim-check";
import type { CopyTurn } from "@/lib/cellumove/copy-session";

export interface SubOption {
  id: string;
  name: string;
  shortDesc: string | null;
  angleName: string;
}
export interface SessionSummary {
  id: string;
  avatarName: string;
  angleSlug: string | null;
  asks: number;
  createdAt: string;
}
export interface ActiveSession {
  id: string;
  avatarName: string;
  turns: CopyTurn[];
}

const QUICK = [
  "10 scroll-stopping hooks for this angle",
  "5 ad headlines",
  "3 Meta primary texts",
  "Rewrite the last one — punchier, shorter",
];

export function CopywriterClient({
  subOptions,
  sessions,
  active,
}: {
  subOptions: SubOption[];
  sessions: SessionSummary[];
  active: ActiveSession | null;
}) {
  const router = useRouter();
  const [subId, setSubId] = useState(subOptions[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<CopyTurn[]>(active?.turns ?? []);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isAsking, startAsk] = useTransition();
  const [isCreating, startCreate] = useTransition();
  const [, startDelete] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, isAsking]);

  const send = (msg: string) => {
    if (!active || isAsking) return;
    const text = msg.trim();
    if (!text) return;
    setError(null);
    setInput("");
    setTurns((t) => [...t, { role: "user", text, at: new Date().toISOString() }]);
    startAsk(async () => {
      try {
        const r = await askCopywriter(active.id, text);
        setTurns((t) => [...t, { role: "copywriter", text: r.reply, at: r.at, claims: r.claims }]);
      } catch (e) {
        setTurns((t) => t.slice(0, -1)); // roll back the optimistic user turn
        setInput(text);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const fixFlagged = (claims: ClaimScan) => {
    const phrases = claims.flags.map((f) => `"${f.phrase}"`).join(", ");
    send(
      `Compliance flagged these words in your last deliverable: ${phrases}. Rewrite it with them removed — swap hard claims for guardrail-compliant framing ("smoother", "the appearance of", "supported", "sculpted look") and keep everything else unchanged.`,
    );
  };

  const create = () => {
    if (!subId || isCreating) return;
    setError(null);
    startCreate(async () => {
      try {
        const { sessionId } = await createCopySession(subId);
        router.push(`/copywriter?s=${sessionId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (s: SessionSummary) => {
    if (!confirm(`Delete the "${s.avatarName}" session and its copy?`)) return;
    startDelete(async () => {
      try {
        await deleteCopySession(s.id);
        if (active?.id === s.id) router.push("/copywriter");
        else router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const copyText = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };

  const flagChip = (type: string) =>
    type === "soften"
      ? "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900"
      : "rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs text-red-700";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Copywriter</h1>
        <p className="text-sm text-ink-500">
          Task the copywriter agent directly — hooks, headlines, scripts, rewrites — grounded in
          the avatar&apos;s research, deep dive, and copy arsenal. It obeys the copywriter SOPs
          from /knowledge.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <div className="card space-y-2">
            <h2 className="text-sm font-semibold">New session</h2>
            {subOptions.length === 0 ? (
              <p className="text-xs text-ink-500">
                No researched avatars yet — complete G1 research under /avatars first.
              </p>
            ) : (
              <>
                <select className="input" value={subId} onChange={(e) => setSubId(e.target.value)}>
                  {subOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.angleName}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary w-full"
                  disabled={!subId || isCreating}
                  onClick={create}
                >
                  {isCreating ? "Opening…" : "Start session"}
                </button>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold">Sessions</h2>
            <ul className="mt-2 space-y-1">
              {sessions.length === 0 && <li className="text-sm text-ink-400">None yet.</li>}
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-1">
                  <Link
                    href={`/copywriter?s=${s.id}`}
                    className={`flex-1 truncate rounded-md px-2 py-1 text-sm transition ${
                      active?.id === s.id
                        ? "bg-ink-100 font-medium text-ink-900"
                        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                    }`}
                  >
                    {s.avatarName}{" "}
                    <span className="text-xs text-ink-400">· {s.asks} asks</span>
                  </Link>
                  <button
                    onClick={() => remove(s)}
                    className="px-1 text-ink-300 transition hover:text-red-600"
                    title="Delete session"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="card flex min-h-[70vh] flex-col">
          {!active ? (
            <p className="m-auto max-w-sm text-center text-sm text-ink-400">
              Start a session on the left, or open an existing one. Then ask for hooks,
              headlines, scripts, or a rewrite — and iterate with follow-ups.
            </p>
          ) : (
            <>
              <div className="border-b border-ink-100 pb-2 text-sm font-semibold">
                {active.avatarName}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto py-3">
                {turns.length === 0 && (
                  <p className="text-sm text-ink-400">
                    Fresh session — ask for the first deliverable, or use a quick prompt below.
                  </p>
                )}
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <div
                      key={i}
                      className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-xl bg-ink-900 px-3 py-2 text-sm text-white"
                    >
                      {t.text}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="max-w-[95%] space-y-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2"
                    >
                      <div className="whitespace-pre-wrap text-sm text-ink-800">{t.text}</div>
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-200 pt-2">
                        {(t.claims?.flags ?? []).map((f) => (
                          <span key={f.phrase} title={f.snippet} className={flagChip(f.type)}>
                            {f.phrase}
                          </span>
                        ))}
                        {(t.claims?.flags.length ?? 0) > 0 && i === turns.length - 1 && (
                          <button className="btn text-xs" onClick={() => fixFlagged(t.claims!)}>
                            Fix flagged
                          </button>
                        )}
                        <button
                          className="btn ml-auto text-xs"
                          onClick={() => copyText(t.text, i)}
                        >
                          {copiedIdx === i ? "Copied ✓" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ),
                )}
                {isAsking && <div className="text-sm text-ink-400">Copywriter is writing…</div>}
                <div ref={endRef} />
              </div>

              <div className="space-y-2 border-t border-ink-100 pt-3">
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
                      disabled={isAsking}
                      onClick={() => setInput(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea
                    className="input min-h-[64px] flex-1"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(input);
                    }}
                    placeholder='Ask the copywriter — e.g. "10 hooks for the heavy-legs angle, her words only" (Ctrl+Enter to send)'
                  />
                  <button
                    className="btn btn-primary self-end"
                    disabled={isAsking || !input.trim()}
                    onClick={() => send(input)}
                  >
                    {isAsking ? "Writing…" : "Send"}
                  </button>
                </div>
                {error && <div className="text-sm text-red-700">{error}</div>}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
