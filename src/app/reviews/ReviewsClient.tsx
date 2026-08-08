"use client";

import { useState, useTransition } from "react";
import { claimRun, setDelivery, submitReview, releaseClaim } from "../actions/reviews";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import type { EditorClaimRow } from "@/lib/database.types";

type Claim = EditorClaimRow & { deliverable: { creativeBriefs?: unknown; adScripts?: unknown } };
type Me = { id: string; username: string; role: Role };
type Claimable = { runId: string; label: string; createdAt: string };

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
}: {
  me: Me;
  claims: Claim[];
  claimable: Claimable[];
  tableMissing: boolean;
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
