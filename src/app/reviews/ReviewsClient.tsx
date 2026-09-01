"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { claimRun, setDelivery, submitReview, releaseClaim } from "../actions/reviews";
import { claimScriptProject, reviewScriptDelivery, submitScriptDelivery } from "../actions/scripts";
import { renderScriptDownload, scriptDownloadFilename, type ScriptDocument } from "@/lib/cellumove/script-studio";
import { SCRIPT_STATUS_META, type ScriptWorkflowStatus } from "@/lib/cellumove/script-workflow";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import type { EditorClaimRow } from "@/lib/database.types";

type Claim = EditorClaimRow & { deliverable: { creativeBriefs?: unknown; adScripts?: unknown } };
type Me = { id: string; username: string; role: Role };
type Claimable = { runId: string; label: string; createdAt: string };
type ScriptPackage = {
  projectId: string;
  title: string;
  displayName: string;
  document: ScriptDocument;
  handoffVersion: number;
  status: ScriptWorkflowStatus;
  editorUserId: string | null;
  editorName: string | null;
  deliveryUrl: string | null;
  reviewNote: string | null;
  product: { name: string; code: string | null; description: string | null; images: Array<{ url: string; altText: string }> };
  sources: Array<{ type: string; title: string; url: string | null }>;
  updatedAt: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending review", cls: "tag tag-warn" },
  changes_requested: { label: "Changes requested", cls: "tag tag-danger" },
  approved: { label: "Approved", cls: "tag tag-ok" },
};

export function ReviewsClient({
  me,
  claims,
  claimable,
  tableMissing,
  scriptPackages,
  scriptTableMissing,
}: {
  me: Me;
  claims: Claim[];
  claimable: Claimable[];
  tableMissing: boolean;
  scriptPackages: ScriptPackage[];
  scriptTableMissing: boolean;
}) {
  const isEditor = me.role === "editor";
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const myClaims = claims.filter((c) => c.claimedByEmail === me.username);
  const shownClaims = isEditor ? myClaims : claims;
  const shownScripts = isEditor
    ? scriptPackages.filter((item) => item.editorUserId === me.id || item.editorUserId === null)
    : scriptPackages;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-ink-500">
          {isEditor
            ? "Claim a creative package, drop the link to your work, and read the strategist's review."
            : "Review claimed work: read the deliverable + the editor's submission, then leave feedback."}{" "}
          <span className="text-ink-400">· You are a {ROLE_LABELS[me.role]}</span>
        </p>
      </header>

      {tableMissing && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The <code className="font-mono">EditorClaim</code> table isn&apos;t set up yet — run{" "}
          <code className="font-mono">migrations/004_editor_claims.sql</code> in the Supabase SQL editor.
        </div>
      )}

      {error && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{error}</div>}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Script Studio handoffs <span className="ml-2 text-xs font-normal text-ink-400">{shownScripts.length}</span></h2>
          <p className="mt-0.5 text-xs text-ink-500">Structured scripts assigned directly or available for an editor to claim.</p>
        </div>
        {scriptTableMissing ? (
          <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">Apply <code className="font-mono">migrations/009_script_studio.sql</code> to enable Script Studio handoffs.</div>
        ) : shownScripts.length === 0 ? (
          <p className="card text-sm text-ink-500">No Script Studio handoffs yet.</p>
        ) : shownScripts.map((item) => <ScriptPackageCard key={item.projectId} item={item} me={me} isEditor={isEditor} run={run} />)}
      </section>

      {/* Editors: available packages to claim */}
      {isEditor && (
        <section className="card">
          <h2 className="text-sm font-semibold">Available creative packages</h2>
          <p className="mt-0.5 text-xs text-ink-500">Completed pipeline packages waiting for an editor.</p>
          <div className="divider" />
          {claimable.length === 0 ? (
            <p className="text-sm text-ink-500">Nothing available right now.</p>
          ) : (
            <ul className="space-y-2">
              {claimable.map((c) => (
                <li
                  key={c.runId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-white p-3"
                >
                  <div>
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-xs text-ink-500">{new Date(c.createdAt).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-primary text-xs" onClick={() => run(() => claimRun(c.runId, c.label))}>
                    Claim →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Claims list (mine, for editors; all, for strategists) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {isEditor ? "My claims" : "Claims to review"}
          <span className="ml-2 text-xs font-normal text-ink-400">{shownClaims.length}</span>
        </h2>
        {shownClaims.length === 0 ? (
          <p className="card text-sm text-ink-500">
            {isEditor ? "You haven't claimed anything yet." : "No claimed packages yet."}
          </p>
        ) : (
          shownClaims.map((c) => (
            <ClaimCard key={c.id} claim={c} me={me} isEditor={isEditor} run={run} />
          ))
        )}
      </section>
    </div>
  );
}

function ScriptPackageCard({ item, me, isEditor, run }: { item: ScriptPackage; me: Me; isEditor: boolean; run: (fn: () => Promise<void>) => void }) {
  const [deliveryUrl, setDeliveryUrl] = useState(item.deliveryUrl ?? "");
  const [note, setNote] = useState(item.reviewNote ?? "");
  const [reviewStatus, setReviewStatus] = useState<"changes_requested" | "approved">("approved");
  const available = item.editorUserId === null;
  const mine = item.editorUserId === me.id;
  const status = SCRIPT_STATUS_META[item.status];
  const readyForMe = isEditor && item.status === "ready" && (available || mine);
  const canDeliver = isEditor && mine && ["claimed", "changes_requested"].includes(item.status);
  const totalDuration = item.document.modules.reduce((sum, module) => sum + module.durationSec, 0);

  const downloadScript = () => {
    const blob = new Blob(["\uFEFF", renderScriptDownload(item.document)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = scriptDownloadFilename(item.document);
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return <article className="overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-card">
    <header className="border-b border-ink-200 bg-gradient-to-r from-brand-purple/[0.07] via-white to-brand-pink/[0.08] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{item.title}</h3><span className={status.className}>{status.label}</span><span className="tag">v{item.handoffVersion} frozen</span></div>
          <div className="mt-1 break-all font-mono text-[10px] text-ink-400">{item.displayName}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><div className="text-right text-xs text-ink-500">{item.editorName ? `@${item.editorName}` : "Unassigned queue"}<div>{totalDuration}s · {new Date(item.updatedAt).toLocaleString()}</div></div><button className="btn bg-white" onClick={downloadScript}>Download script</button></div>
      </div>
      <HandoffProgress status={item.status} />
    </header>

    <div className="space-y-6 p-5">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div>
          <div className="label">Product</div>
          <div className="mt-1 flex items-baseline gap-2"><h4 className="text-base font-semibold">{item.product.name}</h4>{item.product.code && <span className="tag">{item.product.code}</span>}</div>
          {item.product.description && <p className="mt-2 line-clamp-4 text-sm leading-6 text-ink-600">{item.product.description}</p>}
        </div>
        <div>
          <div className="label">Product media · {item.product.images.length}</div>
          {item.product.images.length > 0 ? <div className="mt-2 flex gap-2 overflow-x-auto pb-2">{item.product.images.map((image, index) => <a key={image.url} href={image.url} target="_blank" rel="noreferrer" className="relative block h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-ink-50 transition hover:border-ink-500"><Image src={image.url} alt={image.altText || `${item.product.name} image ${index + 1}`} fill sizes="96px" unoptimized className="object-cover" /></a>)}</div> : <p className="mt-2 text-sm text-ink-400">No product images stored.</p>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h4 className="font-semibold">Production script</h4><p className="text-xs text-ink-500">Read in order; timing is cumulative.</p></div><span className="text-xs text-ink-400">{item.document.format} · {item.document.angle.name}</span></div>
        <div className="divide-y divide-ink-200 rounded-xl border border-ink-200">{item.document.modules.map((module, index) => <ScriptBeat key={module.id} module={module} index={index} priorSeconds={item.document.modules.slice(0, index).reduce((sum, beat) => sum + beat.durationSec, 0)} />)}</div>
      </section>

      <section>
        <h4 className="font-semibold">Source trail</h4>
        <div className="mt-2 flex flex-wrap gap-2">{item.sources.length > 0 ? item.sources.map((source, index) => source.url ? <a key={`${source.type}-${source.title}-${index}`} className="tag hover:underline" href={source.url} target="_blank" rel="noreferrer"><span className="opacity-60">{source.type}</span> · {source.title} ↗</a> : <span key={`${source.type}-${source.title}-${index}`} className="tag"><span className="opacity-60">{source.type}</span> · {source.title}</span>) : <span className="text-sm text-ink-400">No sources attached.</span>}</div>
      </section>

      {readyForMe && <div className="rounded-xl border border-brand-purple/20 bg-brand-purple/5 p-4"><h4 className="font-semibold">Ready to start?</h4><p className="mt-1 text-sm text-ink-600">Claiming locks this package to your editor account.</p><button className="btn btn-primary mt-3" onClick={() => run(() => claimScriptProject(item.projectId))}>{available ? "Claim script" : "Start work"} →</button></div>}
      {canDeliver && <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50 p-4"><label className="label">Delivered creative URL</label><div className="flex flex-col gap-2 sm:flex-row"><input className="input flex-1 bg-white" placeholder="Drive, Frame.io, or another delivery link" value={deliveryUrl} onChange={(event) => setDeliveryUrl(event.target.value)} /><button className="btn btn-primary" onClick={() => run(() => submitScriptDelivery(item.projectId, deliveryUrl))}>Submit delivery</button></div>{item.reviewNote && <div className="rounded-lg bg-white p-3 text-sm"><span className="font-medium">Strategist feedback:</span> {item.reviewNote}</div>}</div>}
      {isEditor && mine && item.status === "submitted" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Delivery submitted. Waiting for strategist review.</div>}
      {!isEditor && <div className="space-y-2 border-t border-ink-200 pt-5"><label className="label">Review editor delivery</label>{item.deliveryUrl ? <a href={item.deliveryUrl} target="_blank" rel="noreferrer" className="block text-sm underline">{item.deliveryUrl}</a> : <p className="text-sm text-ink-400">No delivery submitted yet.</p>}<textarea className="input min-h-20" placeholder="Feedback for the editor…" value={note} onChange={(event) => setNote(event.target.value)} /><div className="flex gap-2"><select className="input max-w-56" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as typeof reviewStatus)}><option value="approved">Approve</option><option value="changes_requested">Request changes</option></select><button className="btn btn-primary" disabled={item.status !== "submitted"} onClick={() => run(() => reviewScriptDelivery(item.projectId, note, reviewStatus))}>Submit review</button></div>{item.status !== "submitted" && <p className="text-xs text-ink-400">Review unlocks after the editor submits a delivery.</p>}</div>}
    </div>
  </article>;
}

const HANDOFF_STEPS: Array<{ status: ScriptWorkflowStatus; label: string }> = [
  { status: "ready", label: "Ready" },
  { status: "claimed", label: "Claimed" },
  { status: "submitted", label: "Submitted" },
  { status: "approved", label: "Approved" },
];

function HandoffProgress({ status }: { status: ScriptWorkflowStatus }) {
  const effectiveStatus = status === "changes_requested" ? "submitted" : status;
  const currentIndex = HANDOFF_STEPS.findIndex((step) => step.status === effectiveStatus);
  return <div className="mt-4 flex max-w-xl items-center" aria-label={`Handoff status: ${SCRIPT_STATUS_META[status].label}`}>{HANDOFF_STEPS.map((step, index) => <div key={step.status} className="flex min-w-0 flex-1 items-center last:flex-none"><div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${index <= currentIndex ? "bg-ink-900 text-white" : "border border-ink-300 bg-white text-ink-400"}`}>{index + 1}</div><span className={`ml-1 hidden text-[10px] sm:inline ${index <= currentIndex ? "text-ink-700" : "text-ink-400"}`}>{step.label}</span>{index < HANDOFF_STEPS.length - 1 && <div className={`mx-2 h-px min-w-3 flex-1 ${index < currentIndex ? "bg-ink-900" : "bg-ink-200"}`} />}</div>)}</div>;
}

function scriptTime(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function ScriptBeat({ module, index, priorSeconds }: { module: ScriptDocument["modules"][number]; index: number; priorSeconds: number }) {
  return <div className="grid gap-3 p-4 md:grid-cols-[7rem_minmax(0,1fr)]"><div><div className="text-xs font-semibold text-ink-700">{index + 1}. {module.label}</div><div className="mt-1 font-mono text-[10px] text-ink-400">{scriptTime(priorSeconds)}–{scriptTime(priorSeconds + module.durationSec)}</div><span className="tag mt-2">{module.kind}</span></div><div className="space-y-3"><div><div className="label">Spoken copy</div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-900">{module.spokenText || "—"}</p></div>{module.onScreenText && <div className="border-l-2 border-brand-pink/40 pl-3"><div className="label">On-screen text</div><p className="mt-1 text-sm font-medium">{module.onScreenText}</p></div>}<div className="rounded-lg bg-ink-50 p-3"><div className="label">Visual direction</div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-600">{module.visualDirection || "—"}</p></div>{module.brollRefs.length > 0 && <div><div className="label">Matched B-roll</div><div className="mt-1 flex flex-wrap gap-2">{module.brollRefs.map((clip) => clip.url ? <a key={`${module.id}-${clip.clipId}`} className="tag hover:underline" href={clip.url} target="_blank" rel="noreferrer">{clip.name} ↗</a> : <span key={`${module.id}-${clip.clipId}`} className="tag">{clip.name}</span>)}</div></div>}</div></div>;
}

function ClaimCard({
  claim,
  me,
  isEditor,
  run,
}: {
  claim: Claim;
  me: Me;
  isEditor: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const status = STATUS_META[claim.reviewStatus] ?? { label: "Pending review", cls: "tag tag-warn" };
  const [delivery, setDeliveryUrl] = useState(claim.deliveryUrl ?? "");
  const [note, setNote] = useState(claim.reviewNote ?? "");
  const [reviewStatus, setReviewStatus] = useState(claim.reviewStatus || "pending");

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-ink-900">{claim.label}</h3>
          <span className={status.cls}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <span>claimed by @{claim.claimedByEmail}</span>
          <button className="btn btn-ghost text-xs" onClick={() => run(() => releaseClaim(claim.id))}>
            Release
          </button>
        </div>
      </div>

      {/* The deliverable the editor works from */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-500">
          Creative briefs (the deliverable)
        </summary>
        <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/50 p-2.5">
          {claim.deliverable.creativeBriefs != null ? (
            <Readable value={claim.deliverable.creativeBriefs} />
          ) : (
            <p className="text-sm text-ink-500">No creative briefs found on this run.</p>
          )}
        </div>
      </details>

      {/* Editor's delivered work */}
      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Delivered work</div>
        {isEditor && claim.claimedByEmail === me.username ? (
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1"
              placeholder="Link to your edited creative (Drive, Frame.io, etc.)"
              value={delivery}
              onChange={(e) => setDeliveryUrl(e.target.value)}
            />
            <button className="btn text-xs sm:w-32" onClick={() => run(() => setDelivery(claim.id, delivery))}>
              Save link
            </button>
          </div>
        ) : claim.deliveryUrl ? (
          <a href={claim.deliveryUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-ink-700 underline hover:text-ink-900">
            {claim.deliveryUrl}
          </a>
        ) : (
          <p className="mt-1 text-sm text-ink-400">Not delivered yet.</p>
        )}
      </div>

      {/* Review */}
      <div className="mt-3 border-t border-ink-100 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Review</div>
        {isEditor ? (
          claim.reviewNote ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{claim.reviewNote}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-400">No review yet.</p>
          )
        ) : (
          <div className="mt-1 space-y-2">
            <textarea
              className="input min-h-[80px]"
              placeholder="Feedback for the editor…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select className="input sm:w-52" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
                <option value="pending">Pending review</option>
                <option value="changes_requested">Changes requested</option>
                <option value="approved">Approved</option>
              </select>
              <button
                className="btn btn-primary text-xs"
                onClick={() => run(() => submitReview(claim.id, note, reviewStatus))}
              >
                Submit review
              </button>
            </div>
          </div>
        )}
        {claim.reviewedByEmail && (
          <div className="mt-1 text-xs text-ink-400">reviewed by @{claim.reviewedByEmail}</div>
        )}
      </div>
    </div>
  );
}

// ─── Minimal readable renderer for the creative-briefs JSON ───────────────────
function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function Readable({ value }: { value: unknown }) {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="whitespace-pre-wrap text-sm text-ink-700">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded border border-ink-200 bg-white p-2">
            <Readable value={v} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{humanize(k)}</div>
            <div className="mt-0.5">
              <Readable value={v} />
            </div>
          </div>
        ))}
    </div>
  );
}
