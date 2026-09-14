import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { markCorpusExtractReviewed } from "@/app/actions/miner";
import { getSessionUser } from "@/lib/auth";
import { requireUser } from "@/lib/authorization";
import { loadAdDetail } from "@/lib/cellumove/corpus/state.server";
import type { BeatGateResult } from "@/lib/cellumove/corpus/evidence-gate";
import { teardownCostUsd, workbookHeadlines } from "@/lib/cellumove/corpus/teardown";
import { createTeardownBrief, ParsedTeardownWorkbookSchema, type TeardownBrief } from "@/lib/cellumove/teardown-brief";
import type { AdTeardownRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Corpus ad · AdFactory" };
export const dynamic = "force-dynamic";

type RawBeat = { order_index?: number; layer?: string; code?: string; t_start?: number; t_end?: number; evidence_quote?: string; channel?: string; other_explanation?: string | null };

function rawBeats(raw: unknown): RawBeat[] {
  if (!raw || typeof raw !== "object" || !("beats" in raw)) return [];
  const beats = (raw as { beats?: unknown }).beats;
  return Array.isArray(beats) ? (beats as RawBeat[]) : [];
}

function gatePerBeat(report: unknown): Map<number, BeatGateResult> {
  if (!report || typeof report !== "object" || !("perBeat" in report)) return new Map();
  const perBeat = (report as { perBeat?: unknown }).perBeat;
  return new Map(Array.isArray(perBeat) ? (perBeat as BeatGateResult[]).map((item) => [item.orderIndex, item]) : []);
}

const sec = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(1)}s`);

const BRIEF_LABEL: Record<Exclude<keyof TeardownBrief, "schemaVersion">, string> = {
  avatar: "Avatar", hook: "Hook & language", problem: "Problem", solution: "Solution & mechanism",
  proof: "Proof", offer: "Offer", cta: "CTA", visual: "Visual & audio", learnings: "Learnings",
};

function TeardownSection({ teardown, adId }: { teardown: AdTeardownRow | null; adId: string }) {
  if (!teardown) {
    return <p className="text-sm text-ink-500">Not torn down. Winners are sent by <code>npm run miner:teardown</code>; this ad alone: <code>npm run miner:teardown -- --ad {adId}</code>.</p>;
  }
  if (teardown.status !== "completed") {
    return (
      <div className="card text-sm">
        <span className={teardown.status === "failed" ? "tag tag-danger" : "tag tag-warn"}>{teardown.status}</span>
        <span className="ml-2 text-ink-500">submitted {new Date(teardown.submittedAt).toLocaleString()}</span>
        {teardown.errorMessage && <p className="mt-2 text-red-700">{teardown.errorCode}: {teardown.errorMessage}</p>}
      </div>
    );
  }
  const workbook = ParsedTeardownWorkbookSchema.safeParse(teardown.workbook);
  if (!workbook.success) return <p className="text-sm text-red-700">Teardown completed but its workbook could not be read.</p>;
  const headlines = workbookHeadlines(workbook.data);
  const brief = createTeardownBrief(workbook.data);
  const fieldByKey = new Map(workbook.data.fields.map((field) => [field.key, field]));
  const cost = teardownCostUsd(teardown);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Gemini&apos;s reading of the ad against the 14-part workbook. Its ratings and &quot;why it wins&quot; claims are the model&apos;s opinion, not evidence — use the beats for anything quantitative.
        {teardown.sheetRowLink && <> · <a href={teardown.sheetRowLink} target="_blank" rel="noreferrer" className="hover:underline">Sheet row ↗</a></>}
        {cost != null && <> · ~${cost.toFixed(2)}</>}
      </p>
      {headlines.length > 0 && (
        <dl className="grid gap-3 md:grid-cols-2">
          {headlines.map((item) => <div key={item.label} className="card"><dt className="text-xs uppercase tracking-wide text-ink-400">{item.label}</dt><dd className="mt-1 text-sm">{item.value}</dd></div>)}
        </dl>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(BRIEF_LABEL) as Array<keyof typeof BRIEF_LABEL>).filter((key) => brief[key].length).map((key) => (
          <details key={key} className="card">
            <summary className="cursor-pointer text-sm font-medium">{BRIEF_LABEL[key]} <span className="text-xs font-normal text-ink-400">{brief[key].length}</span></summary>
            <dl className="mt-2 space-y-2 text-sm">{brief[key].map((item, index) => <div key={index}><dt className="text-xs text-ink-500">{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          </details>
        ))}
      </div>
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Full workbook <span className="text-xs font-normal text-ink-400">{workbook.data.fields.length} fields</span></summary>
        <div className="mt-3 space-y-4 text-sm">
          {workbook.data.sections.map((section) => (
            <div key={section.key}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{section.title}</h3>
              <dl className="mt-1 space-y-1">{section.field_keys.map((key) => fieldByKey.get(key)).filter((field) => field && field.value.trim()).map((field) => <div key={field!.key}><dt className="inline text-ink-500">{field!.label}: </dt><dd className="inline whitespace-pre-line">{field!.value}</dd></div>)}</dl>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default async function CorpusAdPage({ params }: { params: Promise<{ adId: string }> }) {
  await requireUser();
  const { adId } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(adId)) notFound();
  const detail = await loadAdDetail(adId);
  if (!detail) notFound();
  const user = await getSessionUser();
  const { ad, media, transcriptRun, segments, extractRun, beats, state, teardown } = detail;
  const quarantined = extractRun?.status === "needs_human_review";
  const raw = quarantined ? rawBeats(extractRun.rawResponse) : [];
  const gate = gatePerBeat(extractRun?.gateReport);
  const crossCheck = transcriptRun?.crossCheck && typeof transcriptRun.crossCheck === "object" ? (transcriptRun.crossCheck as { verdict?: string; tokenOverlap?: number }) : null;
  const vo = segments.filter((segment) => segment.channel === "vo");
  const ost = segments.filter((segment) => segment.channel === "ost");

  return (
    <div className="space-y-6">
      <header>
        <Link href="/miner" className="text-xs text-ink-500 hover:underline">← Corpus Miner</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{ad.brandName}</h1>{state && <span className="tag">{state.stage}</span>}{ad.formatTag && <span className="tag">{ad.formatTag}</span>}</div>
          {/* The spec's first deliverable: this ad, end to end, as one JSON file. */}
          <a href={`/api/miner/ads/${ad.id}/dump`} className="btn">Download JSON</a>
        </div>
        <p className="mt-1 text-sm text-ink-500">{ad.id}{ad.sourceUrl && <> · <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">source ↗</a></>}{ad.winnerScore != null && <> · longevity score {ad.winnerScore.toFixed(0)} (ranking proxy, not performance)</>}</p>
        {ad.copy && <p className="mt-2 max-w-3xl text-sm text-ink-700">{ad.copy}</p>}
      </header>

      <section className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="card"><div className="text-xs uppercase tracking-wide text-ink-400">Media</div><div className="mt-1">{media ? `${media.status}${media.statusReason ? ` — ${media.statusReason}` : ""}` : "not downloaded"}</div>{media?.bytes != null && <div className="text-xs text-ink-500">{(media.bytes / 1024 / 1024).toFixed(1)}MB · {media.mime} · {sec(media.durationSec)}</div>}</div>
        <div className="card"><div className="text-xs uppercase tracking-wide text-ink-400">Transcript</div><div className="mt-1">{transcriptRun ? `${transcriptRun.status} · ${transcriptRun.segmentCount} segments · ${transcriptRun.language ?? "?"}` : "none"}</div>{crossCheck?.verdict && crossCheck.verdict !== "unavailable" && <div className="text-xs text-ink-500">Provider cross-check: {crossCheck.verdict} ({Math.round((crossCheck.tokenOverlap ?? 0) * 100)}% overlap)</div>}{transcriptRun?.errorSummary && <div className="text-xs text-red-700">{transcriptRun.errorSummary}</div>}</div>
        <div className="card"><div className="text-xs uppercase tracking-wide text-ink-400">Extraction</div><div className="mt-1">{extractRun ? `${extractRun.status} · ${extractRun.attempts} attempt(s) · ${extractRun.taxonomyVersion}` : "none"}</div>{extractRun?.errorSummary && <div className="text-xs text-red-700">{extractRun.errorCode}: {extractRun.errorSummary}</div>}{extractRun?.reviewNote && <div className="text-xs text-ink-500">Review note: {extractRun.reviewNote}</div>}</div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Teardown</h2>
        <TeardownSection teardown={teardown} adId={ad.id} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Transcript</h2>
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-ink-400">Voiceover · {vo.length}</h3>
            {vo.length ? <ol className="mt-2 space-y-1 text-sm">{vo.map((segment) => <li key={segment.id} id={segment.id}><span className="mr-2 tabular-nums text-xs text-ink-400">{segment.tStart.toFixed(1)}–{segment.tEnd.toFixed(1)}</span>{segment.text}</li>)}</ol> : <p className="mt-2 text-sm text-ink-500">No speech.</p>}
          </div>
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-ink-400">On-screen text · {ost.length}</h3>
            {ost.length ? <ol className="mt-2 space-y-1 text-sm">{ost.map((segment) => <li key={segment.id} id={segment.id} className={(segment.confidence ?? 1) < 0.6 ? "text-ink-400" : ""}><span className="mr-2 tabular-nums text-xs text-ink-400">{segment.tStart.toFixed(1)}–{segment.tEnd.toFixed(1)}</span>{segment.text}{(segment.confidence ?? 1) < 0.6 && <span className="ml-2 text-xs">(low confidence)</span>}</li>)}</ol> : <p className="mt-2 text-sm text-ink-500">No on-screen text.</p>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{quarantined ? "Model output (rejected by the evidence gate)" : "Beats"}</h2>
          {beats.length > 0 && (
            <ol className="space-y-2">
              {beats.map((beat) => (
                <li key={beat.id} className="card">
                  <div className="flex flex-wrap items-center gap-2 text-xs"><span className="tag tag-ok">{beat.code}</span><span className="text-ink-500">{beat.layer} · #{beat.orderIndex} · {sec(beat.startSec)}–{sec(beat.endSec)} · {beat.channel}</span>{beat.matchScore != null && beat.matchScore < 100 && <span className="tag tag-warn">fuzzy {beat.matchScore}</span>}</div>
                  <blockquote className="mt-2 border-l-2 border-ink-300 pl-3 text-sm">“{beat.evidenceQuote}”</blockquote>
                  {beat.otherExplanation && <p className="mt-1 text-xs text-ink-600">{beat.otherExplanation}</p>}
                  {beat.matchedSegmentId && <a href={`#${beat.matchedSegmentId}`} className="mt-1 inline-block text-xs text-ink-500 hover:underline">Show segment ↑</a>}
                </li>
              ))}
            </ol>
          )}
          {quarantined && (
            <>
              <ol className="space-y-2">
                {raw.map((beat, index) => {
                  const result = gate.get(beat.order_index ?? index);
                  const bad = Boolean(result?.errors.length);
                  return (
                    <li key={index} className={`card ${bad ? "border-red-200 bg-red-50/60" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2 text-xs"><span className={bad ? "tag tag-danger" : "tag"}>{beat.code ?? "?"}</span><span className="text-ink-500">{beat.layer ?? "?"} · #{beat.order_index ?? index} · {sec(beat.t_start)}–{sec(beat.t_end)} · {beat.channel ?? "?"}</span>{result && <span className="text-ink-500">match {result.matchScore}</span>}</div>
                      <blockquote className={`mt-2 border-l-2 pl-3 text-sm ${bad ? "border-red-300 text-red-900" : "border-ink-300"}`}>“{beat.evidence_quote ?? ""}”</blockquote>
                      {result?.errors.map((error) => <p key={error} className="mt-1 text-xs text-red-700">{error}</p>)}
                    </li>
                  );
                })}
              </ol>
              {!raw.length && <p className="text-sm text-ink-500">The model returned nothing parseable. {extractRun?.errorSummary}</p>}
              {user?.role === "creative_strategist" ? (
                <form action={markCorpusExtractReviewed} className="card space-y-2">
                  <input type="hidden" name="runId" value={extractRun.id} />
                  <input type="hidden" name="adId" value={ad.id} />
                  <label className="block text-sm font-medium">Mark as reviewed</label>
                  <p className="text-xs text-ink-500">Closes this item without writing beats. Re-run <code>npm run miner:extract -- --ad {ad.id} --retry-review</code> after a prompt or taxonomy change.</p>
                  <textarea name="note" rows={2} className="w-full rounded-lg border border-ink-200 p-2 text-sm" placeholder="What went wrong / what the human decomposition is" />
                  <button type="submit" className="btn btn-primary">Mark reviewed</button>
                </form>
              ) : <p className="text-xs text-ink-500">A creative strategist can mark this reviewed.</p>}
            </>
          )}
          {!beats.length && !quarantined && <p className="text-sm text-ink-500">{extractRun ? extractRun.errorSummary ?? "No beats." : "Not extracted yet."}</p>}
        </section>
      </div>
    </div>
  );
}
