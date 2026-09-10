"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type ReactNode, useCallback, useMemo, useState } from "react";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";
import { parseNdjsonChunk } from "@/lib/cellumove/ndjson";
import { normalizeUnsignedIntegerInput } from "@/lib/numeric-input";
import { GenerationConsole } from "./GenerationConsole";
import { InlineAvatarCreator, type InlineAvatarOption } from "./InlineAvatarCreator";
import { InlineFrameworkExtractor, type InlineFrameworkOption } from "./InlineFrameworkExtractor";
import { ProductCombobox, type ProductOption } from "./ProductCombobox";
import { analyzeRawIdea, type StrategistIdeaResult } from "@/app/actions/strategist";

type Option = { id: string; name: string };
type Props = {
  products: ProductOption[];
  angles: Array<Option & { slug: string }>;
  avatars: Array<Option & { angleId: string }>;
  pipelineRuns: Array<Option & { subAvatarId: string; angleId: string }>;
  frameworks: Array<Option & { duration: number | null; extracted: boolean }>;
  strategists: Option[];
  editors: Option[];
  teardowns: Option[];
  formats: string[];
  currentUserId: string;
  teardownConfigured: boolean;
  teardownWarning: string | null;
  initialValues?: { sweepId: string; adIndex: number; idea: string; title: string; creativeName: string; productId?: string; angleId?: string } | null;
};

export function ScriptProjectForm(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [generationEvents, setGenerationEvents] = useState<ScriptGenerationProgressEvent[]>([]);
  const [avatarOptions, setAvatarOptions] = useState(props.avatars);
  // Mutable so a framework copied from a video is selectable without a reload.
  const [frameworkOptions, setFrameworkOptions] = useState(props.frameworks);
  const [strategistPending, setStrategistPending] = useState(false);
  const [strategistResult, setStrategistResult] = useState<StrategistIdeaResult | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchFrameworkIds, setBatchFrameworkIds] = useState<string[]>(() => props.frameworks.slice(0, 2).map((item) => item.id));
  // No angle in the form: the avatar carries it. A prefilled angle only picks
  // which avatar to start on.
  const initialAngleId = props.initialValues?.angleId ?? "";
  const initialAvatars = initialAngleId ? props.avatars.filter((item) => item.angleId === initialAngleId) : props.avatars;
  const [form, setForm] = useState({
    title: props.initialValues?.title ?? "", idea: props.initialValues?.idea ?? "", adNumber: "", creativeName: props.initialValues?.creativeName ?? "", productId: props.initialValues?.productId ?? props.products[0]?.id ?? "",
    subAvatarId: initialAvatars[0]?.id ?? props.avatars[0]?.id ?? "", referenceFormatId: props.frameworks[0]?.id ?? "",
    strategistUserId: props.strategists.some((item) => item.id === props.currentUserId) ? props.currentUserId : props.strategists[0]?.id ?? "",
    editorUserId: "", format: props.formats[0] ?? "UGC", targetDurationSec: "30", teardownRecordId: "", pipelineRunId: "",
    spySweepId: props.initialValues?.sweepId ?? "", spyAdIndex: props.initialValues?.adIndex ?? -1,
  });
  const selectedAvatar = useMemo(() => avatarOptions.find((item) => item.id === form.subAvatarId) ?? null, [avatarOptions, form.subAvatarId]);
  // The angle is whatever the chosen avatar belongs to. It is never picked here.
  const selectedAngle = useMemo(() => props.angles.find((item) => item.id === selectedAvatar?.angleId) ?? null, [props.angles, selectedAvatar]);
  // A run belongs to one avatar, so only that avatar's runs are ever selectable.
  const pipelineRunsForAvatar = useMemo(
    () => props.pipelineRuns.filter((item) => item.subAvatarId === form.subAvatarId),
    [props.pipelineRuns, form.subAvatarId],
  );
  // One flat list of every avatar would be unnavigable, so group it by angle.
  const avatarGroups = useMemo(
    () => props.angles
      .map((angle) => ({ angle, items: avatarOptions.filter((item) => item.angleId === angle.id) }))
      .filter((group) => group.items.length > 0),
    [props.angles, avatarOptions],
  );
  const selectedProduct = useMemo(
    () => props.products.find((item) => item.id === form.productId) ?? null,
    [props.products, form.productId],
  );
  // Split so copied frameworks stay findable as the list grows, and so their
  // provenance shows where the choice is made — without marking the name, which
  // would land in every generated script's stored document.
  const seededFrameworks = useMemo(() => frameworkOptions.filter((item) => !item.extracted), [frameworkOptions]);
  const copiedFrameworks = useMemo(() => frameworkOptions.filter((item) => item.extracted), [frameworkOptions]);

  const submit = async () => {
    setError(null);
    setPending(true);
    setConsoleOpen(true);
    setGenerationEvents([{
      stage: "setup",
      level: "info",
      message: "Connected to the Script Maker generation stream",
      timestamp: new Date().toISOString(),
    }]);
    try {
      const requestInput = {
          ...form,
          targetDurationSec: Number(form.targetDurationSec),
          subAvatarId: form.subAvatarId || null,
          referenceFormatId: form.referenceFormatId || null,
          editorUserId: form.editorUserId || null,
          teardownRecordId: form.teardownRecordId || null,
          pipelineRunId: form.pipelineRunId || null,
          spySweepId: form.spySweepId || null,
          spyAdIndex: form.spyAdIndex >= 0 ? form.spyAdIndex : null,
      };
      const response = await fetch(batchMode ? "/api/scripts/generate-batch" : "/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchMode ? { input: requestInput, frameworkIds: batchFrameworkIds } : requestInput),
      });
      if (response.redirected && response.url.includes("/login")) {
        throw new Error("Your session expired. Sign in again, then retry generation.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Generation request failed with HTTP ${response.status}.`);
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
        throw new Error("The server did not return a generation event stream.");
      }
      if (!response.body) throw new Error("The generation stream did not open.");

      type StreamMessage =
        | { type: "event"; event: ScriptGenerationProgressEvent }
        | { type: "complete"; projectId: string }
        | { type: "complete"; batchId: string }
        | { type: "error"; message: string };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let projectId: string | null = null;
      let batchId: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        const parsed = parseNdjsonChunk<StreamMessage>(buffer, decoder.decode(value ?? new Uint8Array(), { stream: !done }));
        buffer = parsed.remainder;
        for (const message of parsed.values) {
          if (message.type === "event") setGenerationEvents((current) => [...current, message.event]);
          if (message.type === "complete" && "projectId" in message) projectId = message.projectId;
          if (message.type === "complete" && "batchId" in message) batchId = message.batchId;
          if (message.type === "error") throw new Error(message.message);
        }
        if (done) break;
      }
      if (!projectId && !batchId) throw new Error("Generation ended without returning a Script Studio result.");
      setPending(false);
      router.push(batchId ? `/scripts/batches/${batchId}` : `/scripts/${projectId}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setPending(false);
    }
  };

  const targetDuration = Number(form.targetDurationSec);
  // Named in form order, so a disabled Generate button can say what's missing.
  const missing = [
    !form.productId || !selectedProduct?.code ? "a coded product" : null,
    !form.subAvatarId ? "an avatar" : null,
    form.idea.trim().length < 5 ? "the core idea" : null,
    batchMode && batchFrameworkIds.length < 2 ? "two or more frameworks" : null,
    !(Number.isInteger(targetDuration) && targetDuration >= 5 && targetDuration <= 600) ? "a 5–600s duration" : null,
    form.title.trim().length < 2 ? "project title" : null,
    !form.creativeName ? "creative name" : null,
    !form.adNumber ? "ad number" : null,
    !form.strategistUserId ? "a creative strategist" : null,
  ].filter((item): item is string => item !== null);
  const ready = missing.length === 0;
  const handleTargetDurationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const targetDurationSec = normalizeUnsignedIntegerInput(event.currentTarget.value);
    setForm((current) => ({ ...current, targetDurationSec }));
  };
  const handleAvatarCreated = useCallback((avatar: InlineAvatarOption) => {
    setAvatarOptions((current) => [...current.filter((item) => item.id !== avatar.id), avatar].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((current) => ({ ...current, subAvatarId: avatar.id, pipelineRunId: "" }));
  }, []);
  // A framework is only ever copied because the user wants to use it, so select
  // it straight away — and take its duration, matching what the select does.
  const handleFrameworkCreated = useCallback((framework: InlineFrameworkOption) => {
    setFrameworkOptions((current) => [...current.filter((item) => item.id !== framework.id), framework]);
    setForm((current) => ({
      ...current,
      referenceFormatId: framework.id,
      targetDurationSec: framework.duration == null ? current.targetDurationSec : String(framework.duration),
    }));
    setBatchFrameworkIds((current) =>
      current.includes(framework.id) || current.length >= 5 ? current : [...current, framework.id]);
  }, []);
  // Used by the Creative Strategist's angle suggestions: an angle is still a
  // meaningful direction to propose, it just resolves to one of its avatars.
  const selectAngle = (angleId: string) => {
    const first = avatarOptions.find((item) => item.angleId === angleId);
    if (!first) return;
    setForm((current) => ({ ...current, subAvatarId: first.id, pipelineRunId: "" }));
  };
  const handleAvatarChange = (event: ChangeEvent<HTMLSelectElement>) => {
    // Read before the updater: React nulls currentTarget once the handler
    // returns, and an updater runs at render time whenever React cannot
    // evaluate it eagerly.
    const subAvatarId = event.currentTarget.value;
    setForm((current) => ({ ...current, subAvatarId, pipelineRunId: "" }));
  };
  // Only this avatar's runs are listed, so there is no avatar to back-fill.
  const handlePipelineRunChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const pipelineRunId = event.currentTarget.value;
    setForm((current) => ({ ...current, pipelineRunId }));
  };
  const handleConsoleClose = () => setConsoleOpen(false);
  const runStrategist = async () => {
    setError(null);
    setStrategistPending(true);
    try {
      setStrategistResult(await analyzeRawIdea({ idea: form.idea, productId: form.productId, format: form.format }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStrategistPending(false);
    }
  };
  // Inputs follow the order decisions are made: who the ad is for → what it
  // says → how it's structured → project admin.
  return (
    <div className="card space-y-8">
      {props.initialValues && <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">Prefilled from a Spy competitor ad. Review the product and avatar guesses before generating.</div>}

      <FormSection step={1} title="Who it's for" hint="The product and avatar decide which research, verbatims and winners the AI draws on.">
        <div className="grid-fields">
          <div><label className="label">Product</label><ProductCombobox products={props.products} value={form.productId} onChange={(productId) => setForm({ ...form, productId })} /></div>
          <div>
            <label className="label">Avatar</label>
            <select className="input" disabled={avatarGroups.length === 0} value={form.subAvatarId} onChange={handleAvatarChange}>
              {avatarGroups.length === 0
                ? <option value="">No avatars researched yet</option>
                : avatarGroups.map((group) => (
                  <optgroup key={group.angle.id} label={group.angle.name}>
                    {group.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </optgroup>
                ))}
            </select>
            {selectedAngle && <p className="mt-1 text-xs text-ink-500">Angle: {selectedAngle.name}</p>}
            <InlineAvatarCreator angles={props.angles} defaultAngleId={selectedAngle?.id} onCreated={handleAvatarCreated} />
            {avatarGroups.length === 0 && (
              <p className="mt-1 text-sm text-red-700">
                No avatars have been researched yet. Research one on the <Link href="/research" className="underline">Research page</Link>, or create one now with the button above.
              </p>
            )}
          </div>
          {/* Sits under Avatar: a run belongs to the avatar chosen above it. */}
          <div className="sm:col-start-2"><label className="label">Pipeline run <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" value={form.pipelineRunId} onChange={handlePipelineRunChange}><option value="">Use latest run for selected avatar</option>{pipelineRunsForAvatar.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{pipelineRunsForAvatar.length === 0 ? "No completed pipeline runs for this avatar yet." : "Only runs for the selected avatar are listed."}</p></div>
        </div>
        {props.products.length === 0 && <p className="text-sm text-red-700">No coded products are available. Assign a naming code on the <Link href="/products" className="underline">Products page</Link> first.</p>}
        {selectedProduct && !selectedProduct.code && <p className="text-sm text-amber-800">Assign this product a naming code on the <Link href="/products" className="underline">Products page</Link> before creating its script.</p>}
      </FormSection>

      <FormSection step={2} title="The idea" hint="What the ad is saying, and why this avatar should care.">
        <div><div className="flex items-end justify-between gap-2"><label className="label">Core idea / opening brief</label><button type="button" className="btn btn-ghost text-xs" disabled={strategistPending || form.idea.trim().length < 5 || !form.productId} onClick={runStrategist}>{strategistPending ? "Strategist thinking…" : "Run through Creative Strategist"}</button></div><textarea className="input min-h-28" value={form.idea} onChange={(event) => setForm({ ...form, idea: event.target.value })} placeholder="What is the ad saying, and why should this avatar care?" /></div>
        {strategistResult && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <h3 className="font-semibold text-violet-950">Creative Strategist directions</h3>
            <p className="mt-1 text-xs text-violet-800">Saved independently. Picking an angle switches the avatar in step 1; picking a hook replaces the idea above.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {strategistResult.angleCandidates.map((candidate) => {
                const hasAvatar = avatarOptions.some((item) => item.angleId === candidate.angleId);
                return (
                  <button key={candidate.angleId} type="button" className="rounded-lg border border-violet-200 bg-white p-3 text-left text-sm hover:border-violet-600 disabled:opacity-60 disabled:hover:border-violet-200" disabled={!hasAvatar} onClick={() => selectAngle(candidate.angleId)}>
                    <strong>{candidate.angle}</strong>
                    <span className="mt-1 block text-xs text-ink-500">{candidate.rationale}</span>
                    {!hasAvatar && <span className="mt-1 block text-xs text-amber-700">No avatar researched for this angle yet.</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{strategistResult.hookDirections.map((item) => <button key={item.hook} type="button" className="tag max-w-full text-left" title={item.direction} onClick={() => setForm((current) => ({ ...current, idea: item.hook }))}>{item.hook}</button>)}</div>
          </div>
        )}
      </FormSection>

      <FormSection step={3} title="Script structure" hint="The framework shapes the beats; format and duration set how it's shot.">
        <div className="grid-fields">
          <div>
            <label className="label">Reference framework</label>
            <select className="input" disabled={batchMode} value={form.referenceFormatId} onChange={(event) => { const selected = frameworkOptions.find((item) => item.id === event.target.value); setForm({ ...form, referenceFormatId: event.target.value, targetDurationSec: selected?.duration == null ? form.targetDurationSec : String(selected.duration) }); }}>
              <option value="">Standard Hook → CTA</option>
              {seededFrameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              {copiedFrameworks.length > 0 && (
                <optgroup label="Copied from video">
                  {copiedFrameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>
              )}
            </select>
            <InlineFrameworkExtractor onCreated={handleFrameworkCreated} />
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-700"><input type="checkbox" checked={batchMode} onChange={(event) => setBatchMode(event.target.checked)} />Compare several frameworks instead (one draft each)</label>
          </div>
          <div><label className="label">Production format</label><select className="input" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>{props.formats.map((item) => <option key={item}>{item}</option>)}</select></div>
          {batchMode && (
            <div className="sm:col-span-2 rounded-lg border border-ink-200 p-3">
              <p className="text-xs text-ink-500">Pick 2–5 frameworks. Each gets its own editable draft, compared side by side.</p>
              <div className="mt-2 flex flex-wrap gap-2">{frameworkOptions.map((framework) => { const selected = batchFrameworkIds.includes(framework.id); return <label key={framework.id} className={`tag cursor-pointer ${selected ? "border-violet-600 bg-violet-50" : ""}`}><input className="mr-1" type="checkbox" checked={selected} disabled={!selected && batchFrameworkIds.length >= 5} onChange={(event) => setBatchFrameworkIds((current) => event.target.checked ? [...current, framework.id] : current.filter((id) => id !== framework.id))} />{framework.name}</label>; })}</div>
              {batchFrameworkIds.length < 2 && <p className="mt-2 text-xs text-red-700">Choose at least two frameworks.</p>}
            </div>
          )}
          <div><label className="label">Target duration (seconds)</label><input className="input" type="number" min={5} max={600} step={1} value={form.targetDurationSec} onChange={handleTargetDurationChange} /><p className="mt-1 text-xs text-ink-500">Filled from the framework when it has a set length.</p></div>
          <div><label className="label">Teardown2 source <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" disabled={!props.teardownConfigured || props.teardowns.length === 0} value={form.teardownRecordId} onChange={(event) => setForm({ ...form, teardownRecordId: event.target.value })}><option value="">No teardown source</option>{props.teardowns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{!props.teardownConfigured ? "Set TEARDOWN_API_BASE_URL to enable imports." : props.teardownWarning ? `Unavailable: ${props.teardownWarning}` : `${props.teardowns.length} completed records available.`}</p></div>
        </div>
      </FormSection>

      <FormSection step={4} title="Project details" hint="Naming and who's assigned — doesn't change the script itself.">
        <div className="grid-fields">
          <div className="sm:col-span-2"><label className="label">Project title</label><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="CelluMove viral V1" /></div>
          <div><label className="label">Creative name</label><input className="input" value={form.creativeName} onChange={(event) => setForm({ ...form, creativeName: event.target.value })} placeholder="CELLUMOVE VIRAL" /></div>
          <div><label className="label">Ad number</label><input className="input" value={form.adNumber} onChange={(event) => setForm({ ...form, adNumber: event.target.value })} placeholder="SU0800012" /></div>
          <div><label className="label">Creative strategist</label><select className="input" value={form.strategistUserId} onChange={(event) => setForm({ ...form, strategistUserId: event.target.value })}>{props.strategists.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
          <div><label className="label">Video editor <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" value={form.editorUserId} onChange={(event) => setForm({ ...form, editorUserId: event.target.value })}><option value="">Assign later</option>{props.editors.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        </div>
      </FormSection>

      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>{pending ? (batchMode ? "Generating framework batch…" : "Generating complete draft…") : (batchMode ? `Generate ${batchFrameworkIds.length} drafts` : "Generate structured script")}</button>
        <Link href="/scripts" className="btn">Cancel</Link>
        {!ready && !pending && <p className="text-xs text-ink-500">Still needed: {missing.join(", ")}.</p>}
      </div>
      <GenerationConsole open={consoleOpen} running={pending} events={generationEvents} error={error} onClose={handleConsoleClose} />
    </div>
  );
}

function FormSection({ step, title, hint, children }: { step: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3 border-b border-ink-100 pb-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800">{step}</span>
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          <p className="text-xs text-ink-500">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
