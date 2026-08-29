"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  createProduct,
  deleteProduct,
  resetProductToShopify,
  updateProduct,
  uploadProductImage,
} from "../actions/products";

interface ProductLite {
  id: string;
  name: string;
  code: string;
  imagePath: string | null;
  description: string | null;
  sourceLabel?: string;
  hasLocalOverrides?: boolean;
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
  }>;
}

const EMPTY_FORM = { name: "", code: "", description: "", imagePath: "" };

export function ProductsSection({ products, showHeading = true }: { products: ProductLite[]; showHeading?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedGalleryId, setExpandedGalleryId] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const reset = () => {
    setForm(EMPTY_FORM);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startEditing = (product: ProductLite) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      code: product.code,
      description: product.description ?? "",
      imagePath: product.imagePath ?? "",
    });
    setError(null);
    setOpen(false);
    setExpandedGalleryId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setError(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
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

  const onEditFile = async (file: File) => {
    setError(null);
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { imagePath } = await uploadProductImage(fd);
      setEditForm((current) => ({ ...current, imagePath }));
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
          code: form.code,
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
    const product = products.find((item) => item.id === id);
    const warning = product?.sourceLabel
      ? `Delete "${name}" from AdFactory? Shopify will not be changed, and a future sync will import it again.`
      : `Delete product "${name}"?`;
    if (!confirm(warning)) return;
    startSaveTransition(async () => {
      try {
        await deleteProduct(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    setError(null);
    startSaveTransition(async () => {
      try {
        await updateProduct({
          id: editingId,
          name: editForm.name,
          code: editForm.code,
          description: editForm.description || null,
          imagePath: editForm.imagePath || null,
        });
        cancelEditing();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const restoreShopify = (id: string) => {
    setError(null);
    startSaveTransition(async () => {
      try {
        await resetProductToShopify(id);
        cancelEditing();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {showHeading && <div>
          <h2 className="text-lg font-semibold tracking-tight">Products</h2>
          <p className="text-sm text-ink-500">The products you're making ads for.</p>
        </div>}
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
            <div>
              <label className="label">Naming code (optional)</label>
              <input
                className="input uppercase"
                placeholder='e.g. "V1"'
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() })}
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
                  <Image src={form.imagePath} alt="Product preview" width={96} height={96} unoptimized className="h-24 w-24 rounded border border-ink-200 object-cover" />
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
            <li key={p.id} className="card">
              {editingId === p.id ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">Edit product</div>
                      <p className="text-xs text-ink-500">Saved only in AdFactory. Shopify is never changed.</p>
                    </div>
                    {p.sourceLabel && <span className="tag tag-ok">{p.sourceLabel}</span>}
                  </div>
                  <div>
                    <label className="label" htmlFor={`product-name-${p.id}`}>Product name</label>
                    <input id={`product-name-${p.id}`} className="input" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`product-code-${p.id}`}>Naming code (optional)</label>
                    <input id={`product-code-${p.id}`} className="input uppercase" value={editForm.code} onChange={(event) => setEditForm({ ...editForm, code: event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() })} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`product-description-${p.id}`}>Description</label>
                    <textarea id={`product-description-${p.id}`} className="input min-h-[88px]" value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
                  </div>
                  <div>
                    <label className="label">Product image</label>
                    {editForm.imagePath ? (
                      <div className="flex items-start gap-3">
                        <Image src={editForm.imagePath} alt="Edited product preview" width={96} height={96} unoptimized className="h-24 w-24 rounded border border-ink-200 object-cover" />
                        <div className="flex flex-col items-start gap-1">
                          <button type="button" className="text-xs underline" onClick={() => editFileInputRef.current?.click()}>Replace image</button>
                          <button type="button" className="text-xs text-red-700 underline" onClick={() => setEditForm({ ...editForm, imagePath: "" })}>Remove image</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="w-full rounded-md border-2 border-dashed border-ink-300 bg-ink-50 p-4 text-sm hover:border-ink-900" onClick={() => editFileInputRef.current?.click()} disabled={isUploading}>
                        {isUploading ? "Uploading…" : "Upload an AdFactory image"}
                      </button>
                    )}
                    <input ref={editFileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onEditFile(file); }} />
                  </div>
                  {p.images.length > 0 && (
                    <div>
                      <div className="flex items-end justify-between gap-2">
                        <label className="label">Shopify images</label>
                        <span className="text-xs text-ink-500">{p.images.length} available · choose an AdFactory cover</span>
                      </div>
                      <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto rounded-xl border border-ink-200 bg-ink-50 p-2 sm:grid-cols-5">
                        {p.images.map((image) => (
                          <button
                            key={image.id}
                            type="button"
                            aria-label={`Use ${image.altText || "Shopify image"} as AdFactory cover`}
                            title={image.altText || "Use as AdFactory cover"}
                            className={`relative aspect-square overflow-hidden rounded-lg border-2 bg-white ${editForm.imagePath === image.url ? "border-ink-900 ring-2 ring-ink-300" : "border-transparent hover:border-ink-400"}`}
                            onClick={() => setEditForm({ ...editForm, imagePath: image.url })}
                          >
                            <Image src={image.url} alt={image.altText || p.name} fill sizes="96px" unoptimized className="object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {error && <div className="text-sm text-red-700" role="alert">{error}</div>}
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" onClick={saveEdit} disabled={isSaving || isUploading || !editForm.name}>{isSaving ? "Saving…" : "Save in AdFactory"}</button>
                    <button className="btn" onClick={cancelEditing} disabled={isSaving}>Cancel</button>
                    {p.hasLocalOverrides && <button className="btn" onClick={() => restoreShopify(p.id)} disabled={isSaving}>Reset to Shopify</button>}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  {p.imagePath ? (
                    <Image src={p.imagePath} alt={p.name} width={80} height={80} unoptimized className="h-20 w-20 rounded border border-ink-200 object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-ink-300 bg-ink-50 text-xs text-ink-400">no image</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{p.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.sourceLabel && <span className="tag tag-ok">{p.sourceLabel}</span>}
                          {p.hasLocalOverrides && <span className="tag tag-warn">Local edits</span>}
                          {p.code ? <span className="tag">{p.code}</span> : <span className="tag tag-warn">No code</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button className="text-xs text-ink-700 hover:underline" onClick={() => startEditing(p)} disabled={isSaving}>edit</button>
                        <button className="text-xs text-red-700 hover:underline" onClick={() => remove(p.id, p.name)} disabled={isSaving}>delete</button>
                      </div>
                    </div>
                    {p.description && <p className="mt-1 max-h-16 overflow-hidden text-xs text-ink-500">{p.description}</p>}
                    {p.images.length > 0 && (
                      <div className="mt-3 border-t border-ink-100 pt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-ink-700">{p.images.length} Shopify {p.images.length === 1 ? "image" : "images"}</span>
                          {p.images.length > 3 && (
                            <button
                              type="button"
                              className="text-xs text-ink-600 underline hover:text-ink-900"
                              onClick={() => setExpandedGalleryId(expandedGalleryId === p.id ? null : p.id)}
                            >
                              {expandedGalleryId === p.id ? "Collapse" : `View all ${p.images.length}`}
                            </button>
                          )}
                        </div>
                        <div className={`grid gap-1.5 ${expandedGalleryId === p.id ? "max-h-96 grid-cols-4 overflow-y-auto pr-1" : "grid-cols-3"}`}>
                          {(expandedGalleryId === p.id ? p.images : p.images.slice(0, 3)).map((image) => (
                            <button
                              key={image.id}
                              type="button"
                              aria-label={`Preview ${image.altText || "product image"}`}
                              title={image.altText || p.name}
                              className="relative aspect-square overflow-hidden rounded-md border border-ink-200 bg-ink-50"
                              onClick={() => setExpandedGalleryId(p.id)}
                            >
                              <Image src={image.url} alt={image.altText || p.name} fill sizes="120px" loading="lazy" unoptimized className="object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
