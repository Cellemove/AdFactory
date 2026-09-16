"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";
import { parseNdjsonChunk } from "@/lib/cellumove/ndjson";
import { normalizeUnsignedIntegerInput } from "@/lib/numeric-input";
import { GenerationConsole } from "./GenerationConsole";
import { InlineAvatarCreator, type InlineAvatarOption } from "./InlineAvatarCreator";
import { InlineFrameworkExtractor, type InlineFrameworkOption } from "./InlineFrameworkExtractor";
import { ProductCombobox, type ProductOption } from "./ProductCombobox";
import { analyzeRawIdea, type StrategistIdeaResult } from "@/app/actions/strategist";

type Option = { id: string; name: string };
const WIZARD_STEPS = [
  { title: "Audience", description: "Who and where" },
  { title: "Idea", description: "Message and intent" },
  { title: "Structure", description: "Format and pacing" },
  { title: "Project", description: "Naming and assignment" },
  { title: "Review", description: "Evidence and generation" },
] as const;
type ReadinessResult = {
  verbatims: { count: number; fallbackPoolCount: number; targetMin: number; targetMax: number; ready: boolean };
  facts: { count: number; ready: boolean };
  offers: { count: number; selectedValid: boolean; required: boolean; ready: boolean };
  avatarResearch: { ready: boolean };
  reference: { ready: boolean };
  playbook: { ready: boolean };
  warnings: string[];
};
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
  markets: Array<{ code: string; name: string }>;
  offers: Array<{ id: string; productId: string; marketCode: string | null; statement: string; validFrom: string | null; validUntil: string | null }>;
  playbook: { id: string; version: string; title: string } | null;
  currentUserId: string;
  teardownConfigured: boolean;
  teardownWarning: string | null;
  initialValues?: { sweepId: string; adIndex: number; idea: string; title: string; creativeName: string; productId?: string; angleId?: string } | null;
};

export function ScriptProjectForm(props: Props) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [generationEvents, setGenerationEvents] = useState<ScriptGenerationProgressEvent[]>([]);
  const [avatarOptions, setAvatarOptions] = useState(props.avatars);
  // Mutable so a framework copied from a video is selectable without a reload.
  const [frameworkOptions, setFrameworkOptions] = useState(props.frameworks);
  const [strategistPending, setStrategistPending] = useState(false);
  const [strategistResult, setStrategistResult] = useState<StrategistIdeaResult | null>(null);
  const [compareMode, setCompareMode] = useState<"none" | "frameworks" | "heat">("none");
  const [hookMode, setHookMode] = useState<"propose" | "direct">("propose");
  const [batchFrameworkIds, setBatchFrameworkIds] = useState<string[]>(() => props.frameworks.slice(0, 2).map((item) => item.id));
  const [batchHeatLevels, setBatchHeatLevels] = useState<number[]>([2, 3, 4]);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  // No angle in the form: the avatar carries it. A prefilled angle only picks
  // which avatar to start on.
  const initialAngleId = props.initialValues?.angleId ?? "";
  const initialAvatars = initialAngleId ? props.avatars.filter((item) => item.angleId === initialAngleId) : props.avatars;
  const [form, setForm] = useState({
    title: props.initialValues?.title ?? "", idea: props.initialValues?.idea ?? "", conceptLabel: props.initialValues?.title ?? "", hookDirection: "", adNumber: "", creativeName: props.initialValues?.creativeName ?? "", productId: props.initialValues?.productId ?? props.products[0]?.id ?? "",
    subAvatarId: initialAvatars[0]?.id ?? props.avatars[0]?.id ?? "", referenceFormatId: props.frameworks[0]?.id ?? "",
    strategistUserId: props.strategists.some((item) => item.id === props.currentUserId) ? props.currentUserId : props.strategists[0]?.id ?? "",
    editorUserId: "", format: props.formats[0] ?? "UGC", targetDurationSec: "60", teardownRecordId: "", pipelineRunId: "",
    marketCode: props.markets[0]?.code ?? "US", heatLevel: 3, funnelStage: "MOFU", voicePlan: "Standard UGC", offerId: "", referenceMode: "structure_beats", playbookVersionId: props.playbook?.id ?? "",
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
  const applicableOffers = useMemo(() => {
    const now = Date.now();
    return props.offers.filter((offer) => offer.productId === form.productId
      && (!offer.marketCode || offer.marketCode.toUpperCase() === form.marketCode)
      && (!offer.validFrom || new Date(offer.validFrom).getTime() <= now)
      && (!offer.validUntil || new Date(offer.validUntil).getTime() >= now));
  }, [props.offers, form.productId, form.marketCode]);

  useEffect(() => {
    if (!wizardOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = consoleOpen ? null : window.setTimeout(() => stepHeadingRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (consoleOpen) return;
      if (event.key === "Escape" && !pending) {
        setWizardOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    if (!consoleOpen) window.addEventListener("keydown", closeOnEscape);
    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [wizardOpen, currentStep, pending, consoleOpen]);

  useEffect(() => {
    if (!form.productId || !form.subAvatarId || !form.marketCode) {
      setReadiness(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setReadinessLoading(true);
      const params = new URLSearchParams({
        productId: form.productId,
        subAvatarId: form.subAvatarId,
        marketCode: form.marketCode,
        funnelStage: form.funnelStage,
      });
      if (form.offerId) params.set("offerId", form.offerId);
      if (form.referenceFormatId) params.set("referenceFormatId", form.referenceFormatId);
      if (form.teardownRecordId) params.set("teardownRecordId", form.teardownRecordId);
      try {
        const response = await fetch(`/api/scripts/readiness?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as ReadinessResult & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Readiness check failed.");
        setReadiness(payload);
      } catch (cause) {
        if ((cause as { name?: string }).name !== "AbortError") setReadiness(null);
      } finally {
        if (!controller.signal.aborted) setReadinessLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.productId, form.subAvatarId, form.marketCode, form.funnelStage, form.offerId, form.referenceFormatId, form.teardownRecordId]);

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
          hookDirection: hookMode === "direct" ? form.hookDirection.trim() || null : null,
          targetDurationSec: Number(form.targetDurationSec),
          subAvatarId: form.subAvatarId || null,
          referenceFormatId: form.referenceFormatId || null,
          editorUserId: form.editorUserId || null,
          teardownRecordId: form.teardownRecordId || null,
          pipelineRunId: form.pipelineRunId || null,
          spySweepId: form.spySweepId || null,
          spyAdIndex: form.spyAdIndex >= 0 ? form.spyAdIndex : null,
      };
      const batchMode = compareMode !== "none";
      const response = await fetch(batchMode ? "/api/scripts/generate-batch" : "/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchMode ? {
          input: requestInput,
          ...(compareMode === "frameworks" ? { frameworkIds: batchFrameworkIds } : { heatLevels: batchHeatLevels }),
        } : requestInput),
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
  const batchMode = compareMode !== "none";
  // Named in form order, so a disabled Generate button can say what's missing.
  const missing = [
    !form.productId || !selectedProduct?.code ? "a coded product" : null,
    !form.subAvatarId ? "an avatar" : null,
    form.idea.trim().length < 5 ? "the core idea" : null,
    hookMode === "direct" && form.hookDirection.trim().length < 3 ? "a hook direction" : null,
    compareMode === "frameworks" && batchFrameworkIds.length < 2 ? "two or more frameworks" : null,
    compareMode === "heat" && batchHeatLevels.length < 2 ? "two or more Heat levels" : null,
    !form.conceptLabel.trim() ? "a concept label" : null,
    !form.marketCode ? "a market" : null,
    !form.playbookVersionId ? "a published playbook" : null,
    !(Number.isInteger(targetDuration) && targetDuration >= 5 && targetDuration <= 600) ? "a 5–600s duration" : null,
    form.title.trim().length < 2 ? "project title" : null,
    !form.creativeName ? "creative name" : null,
    !form.adNumber ? "ad number" : null,
    !form.strategistUserId ? "a creative strategist" : null,
  ].filter((item): item is string => item !== null);
  const ready = missing.length === 0;
  const stepMissing = [
    [
      !form.productId || !selectedProduct?.code ? "Choose a coded product" : null,
      !form.subAvatarId ? "Choose an avatar" : null,
      !form.marketCode ? "Choose a market" : null,
    ],
    [
      form.idea.trim().length < 5 ? "Describe the core idea" : null,
      !form.conceptLabel.trim() ? "Add a concept label" : null,
      hookMode === "direct" && form.hookDirection.trim().length < 3 ? "Describe the hook direction" : null,
    ],
    [
      !form.playbookVersionId ? "Install a published playbook" : null,
      !(Number.isInteger(targetDuration) && targetDuration >= 5 && targetDuration <= 600) ? "Set a duration between 5 and 600 seconds" : null,
      compareMode === "frameworks" && batchFrameworkIds.length < 2 ? "Choose at least two frameworks" : null,
      compareMode === "heat" && batchHeatLevels.length < 2 ? "Choose at least two Heat levels" : null,
    ],
    [
      form.title.trim().length < 2 ? "Add a project title" : null,
      !form.creativeName.trim() ? "Add a creative name" : null,
      !form.adNumber.trim() ? "Add an ad number" : null,
      !form.strategistUserId ? "Choose a creative strategist" : null,
    ],
    [],
  ].map((items) => items.filter((item): item is string => item !== null));
  const currentStepMissing = stepMissing[currentStep] ?? [];
  const goNext = () => {
    if (currentStepMissing.length > 0 || currentStep >= WIZARD_STEPS.length - 1) return;
    const next = currentStep + 1;
    setCurrentStep(next);
    setFurthestStep((value) => Math.max(value, next));
  };
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
  const handleConsoleClose = useCallback(() => setConsoleOpen(false), []);
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
    <>
      <section aria-hidden={wizardOpen || undefined} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">Guided setup</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink-900">Build one decision at a time</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-500">Five short steps keep strategy, production choices, and project administration separate. Your inputs stay in place if you close and reopen the setup.</p>
          </div>
          <button type="button" className="btn btn-primary min-h-11 shrink-0" onClick={() => setWizardOpen(true)}>{furthestStep > 0 ? "Continue script setup" : "Start script setup"}</button>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-5" aria-label="Setup progress">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.title} className={`rounded-xl border px-3 py-2.5 ${index < currentStep || (currentStep === WIZARD_STEPS.length - 1 && index === currentStep) ? "border-emerald-200 bg-emerald-50" : index === currentStep ? "border-violet-300 bg-violet-50" : "border-ink-100 bg-ink-50"}`}>
              <p className="text-xs font-semibold text-ink-800">{index + 1}. {step.title}</p>
              <p className="mt-0.5 text-[11px] text-ink-500">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {wizardOpen && <div ref={dialogRef} className="fixed inset-0 z-[80] flex items-stretch justify-center bg-ink-950/60 sm:items-center sm:p-6" role="dialog" aria-modal={!consoleOpen} aria-hidden={consoleOpen || undefined} aria-labelledby="script-wizard-title">
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(88dvh,880px)] sm:max-w-5xl sm:rounded-3xl">
          <header className="shrink-0 border-b border-ink-200 bg-white px-4 py-4 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">Create script · Step {currentStep + 1} of {WIZARD_STEPS.length}</p>
                <h2 id="script-wizard-title" ref={stepHeadingRef} tabIndex={-1} className="mt-1 text-xl font-semibold tracking-tight text-ink-900 outline-none sm:text-2xl">{WIZARD_STEPS[currentStep]?.title}</h2>
                <p className="mt-1 text-sm text-ink-500">{WIZARD_STEPS[currentStep]?.description}</p>
              </div>
              <button type="button" className="btn min-h-11 shrink-0" disabled={pending} onClick={() => setWizardOpen(false)} aria-label="Close script setup">Close</button>
            </div>
            <nav className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Script setup steps">
              {WIZARD_STEPS.map((step, index) => {
                const available = index <= furthestStep;
                const active = index === currentStep;
                return <button key={step.title} type="button" disabled={!available || pending} aria-current={active ? "step" : undefined} onClick={() => available && setCurrentStep(index)} className={`min-h-11 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${active ? "border-ink-900 bg-ink-900 text-white" : available ? "border-ink-200 bg-white text-ink-700 hover:border-violet-400" : "cursor-not-allowed border-ink-100 bg-ink-50 text-ink-300"}`}><span className="block sm:hidden">{index + 1}</span><span className="hidden sm:block">{index + 1}. {step.title}</span></button>;
              })}
            </nav>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
            <div className="mx-auto max-w-4xl space-y-6">
              {props.initialValues && currentStep === 0 && <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">Prefilled from a Spy competitor ad. Review the product and avatar guesses before generating.</div>}

      {currentStep === 0 && <FormSection step={1} title="Audience and market" hint="These choices decide which research, verbatims, facts, offers, and winners are eligible.">
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
          <div><label className="label">Market</label><select className="input" value={form.marketCode} onChange={(event) => setForm((current) => ({ ...current, marketCode: event.target.value, offerId: "" }))}>{props.markets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.name}</option>)}</select></div>
          {/* Sits under Avatar: a run belongs to the avatar chosen above it. */}
          <div className="sm:col-start-2"><label className="label">Pipeline run <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" value={form.pipelineRunId} onChange={handlePipelineRunChange}><option value="">Use latest run for selected avatar</option>{pipelineRunsForAvatar.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{pipelineRunsForAvatar.length === 0 ? "No completed pipeline runs for this avatar yet." : "Only runs for the selected avatar are listed."}</p></div>
        </div>
        {props.products.length === 0 && <p className="text-sm text-red-700">No coded products are available. Assign a naming code on the <Link href="/products" className="underline">Products page</Link> first.</p>}
        {selectedProduct && !selectedProduct.code && <p className="text-sm text-amber-800">Assign this product a naming code on the <Link href="/products" className="underline">Products page</Link> before creating its script.</p>}
      </FormSection>}

      {currentStep === 1 && <FormSection step={2} title="Idea brief" hint="State what the ad proves, then set its pressure, funnel job, and delivery.">
        <div className="grid-fields">
          <div><label className="label">Concept label</label><input className="input" value={form.conceptLabel} onChange={(event) => setForm({ ...form, conceptLabel: event.target.value })} placeholder="The 6 PM leg test" /></div>
          <div><label className="label">Funnel stage</label><select className="input" value={form.funnelStage} onChange={(event) => setForm((current) => ({ ...current, funnelStage: event.target.value, offerId: event.target.value === "BOFU" ? current.offerId : "" }))}><option value="TOFU">TOFU · challenge a category belief</option><option value="MOFU">MOFU · challenge a tried alternative</option><option value="BOFU">BOFU · resolve purchase hesitation</option></select></div>
        </div>
        <div><div className="flex items-end justify-between gap-2"><label className="label">Core idea</label><button type="button" className="btn btn-ghost text-xs" disabled={strategistPending || form.idea.trim().length < 5 || !form.productId} onClick={runStrategist}>{strategistPending ? "Strategist thinking…" : "Propose directions"}</button></div><textarea className="input min-h-28" value={form.idea} onChange={(event) => setForm({ ...form, idea: event.target.value })} placeholder="In one sentence: what does this ad prove or accuse?" /></div>
        <div><div className="flex flex-wrap items-center justify-between gap-2"><label className="label">Hook direction</label><div className="rounded-full bg-ink-100 p-1"><button type="button" className={`rounded-full px-3 py-1 text-xs ${hookMode === "propose" ? "bg-white font-semibold shadow-sm" : "text-ink-500"}`} onClick={() => setHookMode("propose")}>Propose</button><button type="button" className={`rounded-full px-3 py-1 text-xs ${hookMode === "direct" ? "bg-white font-semibold shadow-sm" : "text-ink-500"}`} onClick={() => setHookMode("direct")}>Direct it</button></div></div>{hookMode === "direct" ? <textarea className="input min-h-20" value={form.hookDirection} onChange={(event) => setForm({ ...form, hookDirection: event.target.value })} placeholder="Describe the opening visual and line the hooks should explore." /> : <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-3 py-3 text-xs text-ink-500">The generator will propose three directed hooks from the brief and approved evidence.</p>}</div>
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset><legend className="label">Heat</legend><div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4].map((level) => <button key={level} type="button" aria-pressed={form.heatLevel === level} onClick={() => setForm((current) => ({ ...current, heatLevel: level }))} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${form.heatLevel === level ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"}`}>{level}</button>)}</div><p className="mt-2 text-xs text-ink-500">Heat raises force against the problem—not the viewer.</p></fieldset>
          <div><label className="label">Voice plan</label><select className="input" value={form.voicePlan} onChange={(event) => setForm({ ...form, voicePlan: event.target.value })}><option>Standard UGC</option><option>Fast direct response</option><option>Calm testimonial</option><option>Founder explanation</option><option>Sung / musical</option></select><p className="mt-2 text-xs text-ink-500">The speaking-rate band adapts to this choice.</p></div>
        </div>
        <div><label className="label">Approved offer</label><select className="input" value={form.offerId} onChange={(event) => setForm({ ...form, offerId: event.target.value })}><option value="">None</option>{applicableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.statement}</option>)}</select><p className={`mt-1 text-xs ${form.funnelStage === "BOFU" && !form.offerId ? "text-amber-800" : "text-ink-500"}`}>{form.funnelStage === "BOFU" ? "BOFU should use an approved, currently applicable offer." : "TOFU and MOFU default to no offer."}</p></div>
        {strategistResult && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <h3 className="font-semibold text-violet-950">Creative Strategist directions</h3>
            <p className="mt-1 text-xs text-violet-800">Saved independently. Picking an angle switches the avatar in step 1; picking a hook fills the hook direction without replacing the core idea.</p>
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
            <div className="mt-3 flex flex-wrap gap-2">{strategistResult.hookDirections.map((item) => <button key={item.hook} type="button" className="tag max-w-full text-left" title={item.direction} onClick={() => { setHookMode("direct"); setForm((current) => ({ ...current, hookDirection: `${item.hook} — ${item.direction}` })); }}>{item.hook}</button>)}</div>
          </div>
        )}
      </FormSection>}

      {currentStep === 2 && <FormSection step={3} title="Script structure" hint="The framework shapes the beats; format and duration set how it's shot.">
        <div className="grid-fields">
          <div>
            <label className="label">Reference framework</label>
            <select className="input" disabled={compareMode === "frameworks"} value={form.referenceFormatId} onChange={(event) => { const selected = frameworkOptions.find((item) => item.id === event.target.value); setForm({ ...form, referenceFormatId: event.target.value, targetDurationSec: selected?.duration == null ? form.targetDurationSec : String(selected.duration) }); }}>
              <option value="">Standard Hook → CTA</option>
              {seededFrameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              {copiedFrameworks.length > 0 && (
                <optgroup label="Copied from video">
                  {copiedFrameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>
              )}
            </select>
            <InlineFrameworkExtractor onCreated={handleFrameworkCreated} />
            <div className="mt-3"><label className="label">Reference use</label><select className="input" value={form.referenceMode} onChange={(event) => setForm({ ...form, referenceMode: event.target.value })}><option value="structure_beats">Structure and beats only</option><option value="full_style">Structure plus pacing and style</option></select><p className="mt-1 text-xs text-ink-500">Neither mode permits copied lines, figures, offers, or unsupported claims.</p></div>
          </div>
          <div><label className="label">Production format</label><select className="input" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>{props.formats.map((item) => <option key={item}>{item}</option>)}</select></div>
          {compareMode === "frameworks" && (
            <div className="sm:col-span-2 rounded-lg border border-ink-200 p-3">
              <p className="text-xs text-ink-500">Pick 2–5 frameworks. Each gets its own editable draft, compared side by side.</p>
              <div className="mt-2 flex flex-wrap gap-2">{frameworkOptions.map((framework) => { const selected = batchFrameworkIds.includes(framework.id); return <label key={framework.id} className={`tag cursor-pointer ${selected ? "border-violet-600 bg-violet-50" : ""}`}><input className="mr-1" type="checkbox" checked={selected} disabled={!selected && batchFrameworkIds.length >= 5} onChange={(event) => setBatchFrameworkIds((current) => event.target.checked ? [...current, framework.id] : current.filter((id) => id !== framework.id))} />{framework.name}</label>; })}</div>
              {batchFrameworkIds.length < 2 && <p className="mt-2 text-xs text-red-700">Choose at least two frameworks.</p>}
            </div>
          )}
          {compareMode === "heat" && (
            <div className="sm:col-span-2 rounded-lg border border-ink-200 p-3">
              <p className="text-xs text-ink-500">Choose 2–4 Heat levels. Each becomes a separate draft using the same evidence and framework.</p>
              <div className="mt-2 flex gap-2">{[1, 2, 3, 4].map((level) => { const selected = batchHeatLevels.includes(level); return <label key={level} className={`tag cursor-pointer ${selected ? "border-violet-600 bg-violet-50" : ""}`}><input className="mr-1" type="checkbox" checked={selected} onChange={(event) => setBatchHeatLevels((current) => event.target.checked ? [...current, level].sort() : current.filter((item) => item !== level))} />Heat {level}</label>; })}</div>
              {batchHeatLevels.length < 2 && <p className="mt-2 text-xs text-red-700">Choose at least two Heat levels.</p>}
            </div>
          )}
          <div className="sm:col-span-2"><label className="label">Compare drafts</label><div className="flex flex-wrap gap-2"><button type="button" className={`btn ${compareMode === "none" ? "btn-primary" : ""}`} onClick={() => setCompareMode("none")}>Single draft</button><button type="button" className={`btn ${compareMode === "frameworks" ? "btn-primary" : ""}`} onClick={() => setCompareMode("frameworks")}>Compare frameworks</button><button type="button" className={`btn ${compareMode === "heat" ? "btn-primary" : ""}`} onClick={() => setCompareMode("heat")}>Compare Heat</button></div></div>
          <div><label className="label">Target duration (seconds)</label><input className="input" type="number" min={5} max={600} step={1} value={form.targetDurationSec} onChange={handleTargetDurationChange} /><p className="mt-1 text-xs text-ink-500">Filled from the framework when it has a set length.</p></div>
          <div><label className="label">Teardown2 source <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" disabled={!props.teardownConfigured || props.teardowns.length === 0} value={form.teardownRecordId} onChange={(event) => setForm({ ...form, teardownRecordId: event.target.value })}><option value="">No teardown source</option>{props.teardowns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{!props.teardownConfigured ? "Set TEARDOWN_API_BASE_URL to enable imports." : props.teardownWarning ? `Unavailable: ${props.teardownWarning}` : `${props.teardowns.length} completed records available.`}</p></div>
        </div>
      </FormSection>}

      {currentStep === 3 && <FormSection step={4} title="Project details" hint="Naming and who's assigned — doesn't change the script itself.">
        <div className="grid-fields">
          <div className="sm:col-span-2"><label className="label">Project title</label><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="CelluMove viral V1" /></div>
          <div><label className="label">Creative name</label><input className="input" value={form.creativeName} onChange={(event) => setForm({ ...form, creativeName: event.target.value })} placeholder="CELLUMOVE VIRAL" /></div>
          <div><label className="label">Ad number</label><input className="input" value={form.adNumber} onChange={(event) => setForm({ ...form, adNumber: event.target.value })} placeholder="SU0800012" /></div>
          <div><label className="label">Creative strategist</label><select className="input" value={form.strategistUserId} onChange={(event) => setForm({ ...form, strategistUserId: event.target.value })}>{props.strategists.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
          <div><label className="label">Video editor <span className="font-normal normal-case text-ink-400">(optional)</span></label><select className="input" value={form.editorUserId} onChange={(event) => setForm({ ...form, editorUserId: event.target.value })}><option value="">Assign later</option>{props.editors.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        </div>
      </FormSection>}

      {currentStep === 4 && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">Review your setup</h3>
            <p className="mt-1 text-sm text-ink-500">Check the four decisions below. Evidence warnings are advisory and remain visible beside them.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewCard title="Audience" onEdit={() => setCurrentStep(0)} lines={[selectedProduct?.name ?? "No product", selectedAvatar?.name ?? "No avatar", `${form.marketCode} market`]} />
            <ReviewCard title="Idea" onEdit={() => setCurrentStep(1)} lines={[form.conceptLabel || "No concept label", `${form.funnelStage} · Heat ${form.heatLevel}`, hookMode === "direct" ? form.hookDirection : "AI proposes hook directions"]} />
            <ReviewCard title="Structure" onEdit={() => setCurrentStep(2)} lines={[frameworkOptions.find((item) => item.id === form.referenceFormatId)?.name ?? "Standard Hook → CTA", `${form.format} · ${form.targetDurationSec}s`, compareMode === "none" ? "Single draft" : compareMode === "frameworks" ? `${batchFrameworkIds.length} framework drafts` : `${batchHeatLevels.length} Heat drafts`]} />
            <ReviewCard title="Project" onEdit={() => setCurrentStep(3)} lines={[form.title || "No project title", `${form.adNumber || "No ad number"} · ${form.creativeName || "No creative name"}`, `Strategist: ${props.strategists.find((item) => item.id === form.strategistUserId)?.name ?? "Unassigned"}`]} />
          </div>
          {!ready && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Finish these items before generation</p><ul className="mt-2 space-y-1 text-xs">{missing.map((item) => <li key={item}>• {item}</li>)}</ul></div>}
        </section>
        <ReadinessRail result={readiness} loading={readinessLoading} playbook={props.playbook} />
      </div>}

              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            </div>
          </div>

          <footer className="shrink-0 border-t border-ink-200 bg-white px-4 py-4 sm:px-7">
            <div className="mx-auto flex max-w-4xl flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button type="button" className="btn min-h-11" disabled={currentStep === 0 || pending} onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}>Back</button>
                <Link href="/scripts" className="btn btn-ghost min-h-11">Cancel setup</Link>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                {currentStepMissing.length > 0 && <p className="text-xs text-amber-800" aria-live="polite">Next: {currentStepMissing[0]}</p>}
                {currentStep < WIZARD_STEPS.length - 1
                  ? <button type="button" className="btn btn-primary min-h-11 min-w-36" disabled={currentStepMissing.length > 0 || pending} onClick={goNext}>Continue</button>
                  : <button type="button" className="btn btn-primary min-h-11 min-w-48" disabled={pending || !ready} onClick={submit}>{pending ? (batchMode ? "Generating comparison…" : "Generating complete draft…") : compareMode === "frameworks" ? `Generate ${batchFrameworkIds.length} drafts` : compareMode === "heat" ? `Generate ${batchHeatLevels.length} drafts` : "Generate script"}</button>}
              </div>
            </div>
          </footer>
        </div>
      </div>}

      <GenerationConsole open={consoleOpen} running={pending} events={generationEvents} error={error} onClose={handleConsoleClose} />
    </>
  );
}

function ReadinessRail({ result, loading, playbook }: { result: ReadinessResult | null; loading: boolean; playbook: Props["playbook"] }) {
  const rows = result ? [
    { label: "Verified verbatims", value: result.verbatims.count >= result.verbatims.targetMin ? `${result.verbatims.count} direct` : `${result.verbatims.count} direct · ${result.verbatims.fallbackPoolCount} library`, ready: result.verbatims.ready },
    { label: "Approved facts", value: String(result.facts.count), ready: result.facts.ready },
    { label: "Applicable offer", value: result.offers.required ? (result.offers.selectedValid ? "Selected" : "Missing") : "Optional", ready: result.offers.ready },
    { label: "Avatar research", value: result.avatarResearch.ready ? "Ready" : "Missing", ready: result.avatarResearch.ready },
    { label: "Reference", value: result.reference.ready ? "Selected" : "Standard", ready: result.reference.ready },
  ] : [];
  return (
    <aside className="xl:sticky xl:top-24" aria-label="Generation readiness">
      <section className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
        <div className="bg-ink-900 p-4 text-white"><p className="text-sm font-semibold">Workflow readiness</p><p className="mt-1 text-xs text-white/65">Advisory—not a generation gate</p></div>
        <div className="space-y-4 p-4">
          <div><p className="text-xs font-medium text-ink-600">Published playbook</p><p className="mt-1 text-sm font-semibold text-ink-900">{playbook?.title ?? "Not installed"}</p>{playbook && <p className="text-xs text-ink-500">{playbook.version}</p>}</div>
          {loading ? <p className="text-sm text-ink-500">Checking evidence…</p> : rows.length ? <ul className="space-y-2">{rows.map((row) => <li key={row.label} className="flex items-center justify-between gap-3 text-xs"><span className="text-ink-600">{row.label}</span><span className={row.ready ? "tag tag-ok" : "tag tag-warn"}>{row.value}</span></li>)}</ul> : <p className="text-sm text-ink-500">Choose a product, avatar, and market to check the evidence.</p>}
          {result?.warnings.length ? <div className="border-t border-ink-200 pt-3"><p className="text-xs font-semibold text-amber-900">Safe-fallback warnings</p><ul className="mt-2 space-y-2 text-xs leading-4 text-amber-800">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : result ? <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">Core workflow inputs are ready.</p> : null}
        </div>
      </section>
    </aside>
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

function ReviewCard({ title, lines, onEdit }: { title: string; lines: string[]; onEdit: () => void }) {
  return (
    <article className="rounded-2xl border border-ink-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-ink-900">{title}</h4><button type="button" className="text-xs font-semibold text-violet-700 underline-offset-2 hover:underline" onClick={onEdit}>Edit</button></div>
      <ul className="mt-3 space-y-1 text-xs leading-5 text-ink-500">{lines.map((line, index) => <li key={`${index}-${line}`} className="line-clamp-2">{line}</li>)}</ul>
    </article>
  );
}
