"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createScriptProject } from "@/app/actions/scripts";
import { ProductCombobox, type ProductOption } from "./ProductCombobox";

type Option = { id: string; name: string };
type Props = {
  products: ProductOption[];
  angles: Option[];
  avatars: Array<Option & { angleId: string }>;
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", idea: "", adNumber: "", creativeName: "", productId: props.products[0]?.id ?? "",
    angleId: props.angles[0]?.id ?? "", subAvatarId: "", referenceFormatId: props.frameworks[0]?.id ?? "",
    strategistUserId: props.strategists.some((item) => item.id === props.currentUserId) ? props.currentUserId : props.strategists[0]?.id ?? "",
    editorUserId: "", format: props.formats[0] ?? "UGC", targetDurationSec: 30, teardownRecordId: "",
  });
  const avatars = useMemo(() => props.avatars.filter((item) => item.angleId === form.angleId), [props.avatars, form.angleId]);
  const selectedProduct = useMemo(
    () => props.products.find((item) => item.id === form.productId) ?? null,
    [props.products, form.productId],
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createScriptProject({
          ...form,
          subAvatarId: form.subAvatarId || null,
          referenceFormatId: form.referenceFormatId || null,
          editorUserId: form.editorUserId || null,
          teardownRecordId: form.teardownRecordId || null,
        });
        router.push(`/scripts/${result.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const ready = form.title.trim().length >= 2 && form.idea.trim().length >= 5 && form.adNumber && form.creativeName && form.productId && selectedProduct?.code && form.angleId && form.strategistUserId;
  return (
    <div className="card space-y-5">
      <div className="grid-fields">
        <div><label className="label">Project title</label><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="CelluMove viral V1" /></div>
        <div><label className="label">Creative name</label><input className="input" value={form.creativeName} onChange={(event) => setForm({ ...form, creativeName: event.target.value })} placeholder="CELLUMOVE VIRAL" /></div>
        <div><label className="label">Ad number</label><input className="input" value={form.adNumber} onChange={(event) => setForm({ ...form, adNumber: event.target.value })} placeholder="SU0800012" /></div>
        <div><label className="label">Product</label><ProductCombobox products={props.products} value={form.productId} onChange={(productId) => setForm({ ...form, productId })} /></div>
        <div><label className="label">Angle</label><select className="input" value={form.angleId} onChange={(event) => setForm({ ...form, angleId: event.target.value, subAvatarId: "" })}>{props.angles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="label">Avatar</label><select className="input" value={form.subAvatarId} onChange={(event) => setForm({ ...form, subAvatarId: event.target.value })}><option value="">No specific avatar</option>{avatars.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="label">Reference framework</label><select className="input" value={form.referenceFormatId} onChange={(event) => { const selected = props.frameworks.find((item) => item.id === event.target.value); setForm({ ...form, referenceFormatId: event.target.value, targetDurationSec: selected?.duration ?? form.targetDurationSec }); }}><option value="">Standard Hook → CTA</option>{props.frameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="label">Production format</label><select className="input" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>{props.formats.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div><label className="label">Creative strategist</label><select className="input" value={form.strategistUserId} onChange={(event) => setForm({ ...form, strategistUserId: event.target.value })}>{props.strategists.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        <div><label className="label">Editor</label><select className="input" value={form.editorUserId} onChange={(event) => setForm({ ...form, editorUserId: event.target.value })}><option value="">Unassigned queue</option>{props.editors.map((item) => <option key={item.id} value={item.id}>@{item.name}</option>)}</select></div>
        <div><label className="label">Target duration (seconds)</label><input className="input" type="number" min={5} max={600} value={form.targetDurationSec} onChange={(event) => setForm({ ...form, targetDurationSec: Number(event.target.value) })} /></div>
        <div><label className="label">Teardown2 source</label><select className="input" disabled={!props.teardownConfigured || props.teardowns.length === 0} value={form.teardownRecordId} onChange={(event) => setForm({ ...form, teardownRecordId: event.target.value })}><option value="">No teardown source</option>{props.teardowns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-xs text-ink-500">{!props.teardownConfigured ? "Set TEARDOWN_API_BASE_URL to enable imports." : props.teardownWarning ? `Unavailable: ${props.teardownWarning}` : `${props.teardowns.length} completed records available.`}</p></div>
        <div className="sm:col-span-2"><label className="label">Core idea / opening brief</label><textarea className="input min-h-28" value={form.idea} onChange={(event) => setForm({ ...form, idea: event.target.value })} placeholder="What is the ad saying, and why should this avatar care?" /></div>
      </div>
      {props.products.length === 0 && <p className="text-sm text-red-700">No coded products are available. Assign a naming code on the <Link href="/products" className="underline">Products page</Link> first.</p>}
      {selectedProduct && !selectedProduct.code && <p className="text-sm text-amber-800">Assign this product a naming code on the <Link href="/products" className="underline">Products page</Link> before creating its script.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>{pending ? "Generating complete draft…" : "Generate structured script"}</button><Link href="/scripts" className="btn">Cancel</Link></div>
    </div>
  );
}
