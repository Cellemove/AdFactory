"use client";

import { useRef, useState, useTransition } from "react";
import { createProduct, deleteProduct, uploadProductImage } from "../actions/products";

interface ProductLite {
  id: string;
  name: string;
  imagePath: string | null;
  description: string | null;
}

export function ProductsSection({ products }: { products: ProductLite[] }) {
  const [open, setOpen] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ name: "", description: "", imagePath: "" });

  const reset = () => {
    setForm({ name: "", description: "", imagePath: "" });
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFile = async (file: File) => {
    setError(null);
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { imagePath } = await uploadProductImage(fd);
      setForm((f) => ({ ...f, imagePath }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUploading(false);
    }
  };

  const submit = () => {
    setError(null);
    startSaveTransition(async () => {
      try {
        await createProduct({
          name: form.name,
          imagePath: form.imagePath || null,
          description: form.description || null,
        });
        setOpen(false);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete product "${name}"?`)) return;
    startSaveTransition(async () => {
      try { await deleteProduct(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Products</h2>
          <p className="text-sm text-ink-500">The products you're making ads for.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { if (open) { setOpen(false); reset(); } else setOpen(true); }}>
          {open ? "Close" : "+ Add product"}
        </button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div className="grid-fields">
            <div className="sm:col-span-2">
              <label className="label">Label (product name)</label>
              <input
                className="input"
                placeholder='e.g. "Anti-Cellulite Leggings — Short"'
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description (optional)</label>
              <textarea
                className="input min-h-[60px]"
                placeholder="Anything the engine should know — colors, sizing, fabric, key features."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Product image</label>
              {form.imagePath ? (
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.imagePath} alt="product" className="h-24 w-24 rounded border border-ink-200 object-cover" />
                  <button
                    type="button"
                    className="text-xs text-ink-500 underline hover:text-ink-900"
                    onClick={() => { setForm((f) => ({ ...f, imagePath: "" })); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-ink-300 bg-ink-50 p-6 text-center text-sm transition hover:border-ink-900 ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                >
                  {isUploading ? "Uploading…" : "Click to upload (PNG/JPEG/WEBP/GIF, ≤8MB)"}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />
            </div>
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={isSaving || isUploading || !form.name}
            >
              {isSaving ? "Saving…" : "Save product"}
            </button>
            <button className="btn" onClick={() => { setOpen(false); reset(); }} disabled={isSaving}>Cancel</button>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <div className="card">
          <p className="text-sm text-ink-500">No products yet. Add one to start associating ads with what you're selling.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li key={p.id} className="card flex gap-3">
              {p.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imagePath} alt={p.name} className="h-20 w-20 rounded border border-ink-200 object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded border border-dashed border-ink-300 bg-ink-50 text-xs text-ink-400">
                  no image
                </div>
              )}
              <div className="flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <button
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => remove(p.id, p.name)}
                    disabled={isSaving}
                  >
                    delete
                  </button>
                </div>
                {p.description && <p className="mt-1 text-xs text-ink-500">{p.description}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
