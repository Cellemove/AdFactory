"use client";

import { useState, useTransition } from "react";
import { runScriptPipeline, type PipelineResult } from "../actions/pipeline";

interface SubOption {
  id: string; name: string; angleName: string; shortDesc: string | null; hasResearch: boolean;
}

export function ScriptClient({
  subOptions, formats, markets,
}: {
  subOptions: SubOption[];
  formats: Array<{ slug: string; name: string }>;
  markets: Array<{ code: string; name: string }>;
}) {
  const [subAvatarId, setSubAvatarId] = useState("");
  const [coreIdea, setCoreIdea] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
  const [marketCode, setMarketCode] = useState("");
  const [duration, setDuration] = useState("30");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSub = subOptions.find((s) => s.id === subAvatarId);

  const toggleFormat = (slug: string) =>
    setSelectedFormats((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const submit = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await runScriptPipeline({
          subAvatarId,
          coreIdea,
          formatSlugs: selectedFormats.length ? selectedFormats : undefined,
          marketCode: marketCode || null,
          targetDurationSec: duration ? Number(duration) : null,
        });
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const canRun = subAvatarId && coreIdea.trim().length >= 3 && !isPending;

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="grid-fields">
          <div>
            <label className="label">Sub-avatar</label>
            <select className="input" value={subAvatarId} onChange={(e) => setSubAvatarId(e.target.value)}>
              <option value="">Select a sub-avatar…</option>
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.angleName}{s.hasResearch ? "" : " (no research)"}
                </option>
              ))}
            </select>
            {selectedSub && !selectedSub.hasResearch && (
              <p className="mt-1 text-xs text-amber-700">
                This sub-avatar has no research attached — the pipeline will block. Add research under /avatars first.
              </p>
            )}
            {selectedSub?.shortDesc && <p className="mt-1 text-xs text-ink-500">{selectedSub.shortDesc}</p>}
          </div>
          <div>
            <label className="label">Market (optional)</label>
            <select className="input" value={marketCode} onChange={(e) => setMarketCode(e.target.value)}>
              <option value="">— none —</option>
              {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Core idea</label>
          <textarea
            className="input min-h-[80px]"
            placeholder="The message, angle, or insight to build the scripts around…"
            value={coreIdea}
            onChange={(e) => setCoreIdea(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Reference formats {selectedFormats.length === 0 && <span className="text-ink-400">(none selected → top 3 used)</span>}</label>
          {formats.length === 0 ? (
            <p className="text-xs text-amber-700">No reference formats found. Run <code>npm run seed:sop</code> first.</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-2">
              {formats.map((f) => (
                <button
                  key={f.slug}
                  type="button"
                  onClick={() => toggleFormat(f.slug)}
                  className={`rounded-md border px-2.5 py-1 text-sm transition ${
                    selectedFormats.includes(f.slug)
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-200 text-ink-700 hover:bg-ink-100"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-end gap-3">
          <div className="w-32">
            <label className="label">Duration (s)</label>
            <input className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={!canRun} onClick={submit}>
            {isPending ? "Running pipeline…" : "Generate scripts"}
          </button>
        </div>

        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>

      {result && <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: PipelineResult }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-600">
        <span className="font-semibold">{result.subAvatarName}</span> · {result.angleName}
        {result.marketName && <> · {result.marketName}</>} · {result.packages.length} script{result.packages.length === 1 ? "" : "s"}
      </div>

      {result.packages.map((pkg, i) => (
        <div key={i} className="card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">{pkg.script.title || pkg.brief.formatName}</h3>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="tag">{pkg.brief.formatName}</span>
                <span className={`tag ${pkg.compliance.status === "warn" ? "tag-warn" : ""}`}>
                  compliance: {pkg.compliance.status}{pkg.compliance.corrected ? " (auto-fixed)" : ""}
                </span>
              </div>
            </div>
          </div>

          {pkg.brief.positioning && (
            <p className="text-xs text-ink-500"><span className="font-semibold">Strategy:</span> {pkg.brief.positioning}</p>
          )}

          {/* Hooks */}
          {pkg.script.hooks?.length > 0 && (
            <div>
              <div className="label">Hooks (3 diverse)</div>
              <ul className="mt-1 space-y-1">
                {pkg.script.hooks.map((h, j) => (
                  <li key={j} className="text-sm">
                    <span className="tag mr-1">{h.mechanic || h.label}</span>{h.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Storyboard */}
          {pkg.script.beats?.length > 0 && (
            <div>
              <div className="label">Storyboard</div>
              <ol className="mt-1 space-y-1.5">
                {pkg.script.beats.map((b, j) => (
                  <li key={j} className="text-sm">
                    <span className="font-mono text-xs text-ink-400">{b.time}</span>{" "}
                    <span className="font-semibold">{b.label}</span>
                    {b.onScreenText && <div className="text-ink-700">“{b.onScreenText}”</div>}
                    {b.voiceover && <div className="text-ink-500">VO: {b.voiceover}</div>}
                    {b.visual && <div className="text-xs text-ink-500">Visual: {b.visual}</div>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Compliance issues */}
          {pkg.compliance.issues.length > 0 && (
            <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              <div className="font-semibold">Compliance flags{pkg.compliance.corrected ? " (before auto-fix)" : ""}:</div>
              <ul className="mt-0.5 list-disc pl-4">
                {pkg.compliance.issues.map((iss, j) => <li key={j}>{iss}</li>)}
              </ul>
            </div>
          )}

          {/* Design */}
          {(pkg.design.brollByBeat.length > 0 || pkg.design.ugcBrief || pkg.design.missingClips.length > 0) && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-700">Visual / B-roll plan</summary>
              <div className="mt-2 space-y-2">
                {pkg.design.brollByBeat.map((b, j) => (
                  <div key={j} className="text-xs">
                    <span className="font-semibold">{b.beat}:</span> {b.suggestions?.join(" · ")}
                  </div>
                ))}
                {pkg.design.ugcBrief && (
                  <div className="text-xs"><span className="font-semibold">UGC brief:</span> {pkg.design.ugcBrief}</div>
                )}
                {pkg.design.missingClips.length > 0 && (
                  <div className="text-xs text-red-700">
                    <span className="font-semibold">Missing clips to shoot:</span> {pkg.design.missingClips.join(" · ")}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
