"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import type { ScriptGenerationProgressEvent } from "@/lib/cellumove/script-generation-progress";
import { parseNdjsonChunk } from "@/lib/cellumove/ndjson";
import { normalizeUnsignedIntegerInput } from "@/lib/numeric-input";
import { GenerationConsole } from "./GenerationConsole";
import { InlineAvatarCreator, type InlineAvatarOption } from "./InlineAvatarCreator";
import { ProductCombobox, type ProductOption } from "./ProductCombobox";

type Option = { id: string; name: string };
type Props = {
  products: ProductOption[];
  angles: Array<Option & { slug: string }>;
  avatars: Array<Option & { angleId: string }>;
  pipelineRuns: Array<Option & { subAvatarId: string; angleId: string }>;
  frameworks: Array<Option & { duration: number | null }>;
  strategists: Option[];
  editors: Option[];
  teardowns: Option[];
  formats: string[];
  currentUserId: string;
  teardownConfigured: boolean;
  teardownWarning: string | null;
};

export function ScriptProjectForm(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [generationEvents, setGenerationEvents] = useState<ScriptGenerationProgressEvent[]>([]);
  const [avatarOptions, setAvatarOptions] = useState(props.avatars);
  const [form, setForm] = useState({
    title: "", idea: "", adNumber: "", creativeName: "", productId: props.products[0]?.id ?? "",
    angleId: props.angles[0]?.id ?? "", subAvatarId: "", referenceFormatId: props.frameworks[0]?.id ?? "",
    strategistUserId: props.strategists.some((item) => item.id === props.currentUserId) ? props.currentUserId : props.strategists[0]?.id ?? "",
    editorUserId: "", format: props.formats[0] ?? "UGC", targetDurationSec: "30", teardownRecordId: "", pipelineRunId: "",
  });
  const avatars = useMemo(() => avatarOptions.filter((item) => item.angleId === form.angleId), [avatarOptions, form.angleId]);
  const selectedAngle = useMemo(() => props.angles.find((item) => item.id === form.angleId) ?? null, [props.angles, form.angleId]);
  const selectedProduct = useMemo(
    () => props.products.find((item) => item.id === form.productId) ?? null,
    [props.products, form.productId],
  );

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
      const response = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          targetDurationSec: Number(form.targetDurationSec),
          subAvatarId: form.subAvatarId || null,
          referenceFormatId: form.referenceFormatId || null,
          editorUserId: form.editorUserId || null,
          teardownRecordId: form.teardownRecordId || null,
          pipelineRunId: form.pipelineRunId || null,
        }),
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
        | { type: "error"; message: string };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let projectId: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        const parsed = parseNdjsonChunk<StreamMessage>(buffer, decoder.decode(value ?? new Uint8Array(), { stream: !done }));
        buffer = parsed.remainder;
        for (const message of parsed.values) {
          if (message.type === "event") setGenerationEvents((current) => [...current, message.event]);
          if (message.type === "complete") projectId = message.projectId;
          if (message.type === "error") throw new Error(message.message);
        }
        if (done) break;
      }
      if (!projectId) throw new Error("Generation ended without returning a Script Studio project.");
      setPending(false);
      router.push(`/scripts/${projectId}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setPending(false);
    }
  };

  const targetDuration = Number(form.targetDurationSec);
  const ready = form.title.trim().length >= 2 && form.idea.trim().length >= 5 && form.adNumber && form.creativeName && form.productId && selectedProduct?.code && form.angleId && form.strategistUserId && Number.isInteger(targetDuration) && targetDuration >= 5 && targetDuration <= 600;
  const handleTargetDurationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const targetDurationSec = normalizeUnsignedIntegerInput(event.currentTarget.value);
    setForm((current) => ({ ...current, targetDurationSec }));
  };
  const handleAvatarCreated = useCallback((avatar: InlineAvatarOption) => {
    setAvatarOptions((current) => [...current.filter((item) => item.id !== avatar.id), avatar].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((current) => ({ ...current, subAvatarId: avatar.id, pipelineRunId: "" }));
  }, []);
  const handleAngleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({ ...current, angleId: event.currentTarget.value, subAvatarId: "", pipelineRunId: "" }));
  };
  const handleAvatarChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({ ...current, subAvatarId: event.currentTarget.value, pipelineRunId: "" }));
  };
  const handlePipelineRunChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const pipelineRunId = event.currentTarget.value;
    const run = props.pipelineRuns.find((item) => item.id === pipelineRunId);
    setForm((current) => ({
      ...current,
      pipelineRunId,
      angleId: run?.angleId ?? current.angleId,
      subAvatarId: run?.subAvatarId ?? current.subAvatarId,
    }));
  };
  const handleConsoleClose = () => setConsoleOpen(false);
  return (
    <div className="card space-y-5">
      <div className="grid-fields">
        <div><label className="label">Project title</label><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="CelluMove viral V1" /></div>
        <div><label className="label">Creative name</label><input className="input" value={form.creativeName} onChange={(event) => setForm({ ...form, creativeName: event.target.value })} placeholder="CELLUMOVE VIRAL" /></div>
        <div><label className="label">Ad number</label><input className="input" value={form.adNumber} onChange={(event) => setForm({ ...form, adNumber: event.target.value })} placeholder="SU0800012" /></div>
        <div><label className="label">Product</label><ProductCombobox products={props.products} value={form.productId} onChange={(productId) => setForm({ ...form, productId })} /></div>
        <div><label className="label">Angle</label><select className="input" value={form.angleId} onChange={handleAngleChange}>{props.angles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="label">Avatar</label><select className="input" value={form.subAvatarId} onChange={handleAvatarChange}><option value="">No specific avatar</option>{avatars.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><InlineAvatarCreator key={form.angleId} angle={selectedAngle} onCreated={handleAvatarCreated} /></div>
        <div><label className="label">Pipeline run <span className="font-normal text-ink-400">(optional)</span></label><select className="input" value={form.pipelineRunId} onChange={handlePipelineRunChange}><option value="">Use latest run for selected avatar</option>{props.pipelineRuns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">Selecting a run also selects its angle and avatar.</p></div>
        <div><label className="label">Reference framework</label><select className="input" value={form.referenceFormatId} onChange={(event) => { const selected = props.frameworks.find((item) => item.id === event.target.value); setForm({ ...form, referenceFormatId: event.target.value, targetDurationSec: selected?.duration == null ? form.targetDurationSec : String(selected.duration) }); }}><option value="">Standard Hook → CTA</option>{props.frameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="label">Production format</label><select className="input" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>{props.formats.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div><label className="label">Creative strategist</label><select className="input" value={form.strategistUserId} onChange={(event) => setForm({ ...form, strategistUserId: event.target.value })}>{props.strategists.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        <div><label className="label">Video editor (optional)</label><select className="input" value={form.editorUserId} onChange={(event) => setForm({ ...form, editorUserId: event.target.value })}><option value="">Assign later</option>{props.editors.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        <div><label className="label">Target duration (seconds)</label><input className="input" type="number" min={5} max={600} step={1} value={form.targetDurationSec} onChange={handleTargetDurationChange} /></div>
        <div><label className="label">Teardown2 source</label><select className="input" disabled={!props.teardownConfigured || props.teardowns.length === 0} value={form.teardownRecordId} onChange={(event) => setForm({ ...form, teardownRecordId: event.target.value })}><option value="">No teardown source</option>{props.teardowns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{!props.teardownConfigured ? "Set TEARDOWN_API_BASE_URL to enable imports." : props.teardownWarning ? `Unavailable: ${props.teardownWarning}` : `${props.teardowns.length} completed records available.`}</p></div>
        <div className="sm:col-span-2"><label className="label">Core idea / opening brief</label><textarea className="input min-h-28" value={form.idea} onChange={(event) => setForm({ ...form, idea: event.target.value })} placeholder="What is the ad saying, and why should this avatar care?" /></div>
      </div>
      {props.products.length === 0 && <p className="text-sm text-red-700">No coded products are available. Assign a naming code on the <Link href="/products" className="underline">Products page</Link> first.</p>}
      {selectedProduct && !selectedProduct.code && <p className="text-sm text-amber-800">Assign this product a naming code on the <Link href="/products" className="underline">Products page</Link> before creating its script.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>{pending ? "Generating complete draft…" : "Generate structured script"}</button><Link href="/scripts" className="btn">Cancel</Link></div>
      <GenerationConsole open={consoleOpen} running={pending} events={generationEvents} error={error} onClose={handleConsoleClose} />
    </div>
  );
}
