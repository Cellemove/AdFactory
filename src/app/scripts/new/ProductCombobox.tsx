"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ProductOption = {
  id: string;
  name: string;
  code: string;
  imagePath: string | null;
};

type Props = {
  products: ProductOption[];
  value: string;
  onChange: (productId: string) => void;
};

function ProductThumbnail({ product, size = "small" }: { product: ProductOption; size?: "small" | "large" }) {
  const [failed, setFailed] = useState(false);
  const dimensions = size === "large" ? "h-12 w-12" : "h-9 w-9";

  useEffect(() => setFailed(false), [product.imagePath]);

  return (
    <span className={`relative shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-100 ${dimensions}`}>
      {product.imagePath && !failed ? (
        <Image
          src={product.imagePath}
          alt=""
          fill
          sizes={size === "large" ? "48px" : "36px"}
          unoptimized
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase text-ink-400">
          {product.name.slice(0, 2)}
        </span>
      )}
    </span>
  );
}

export function ProductCombobox({ products, value, onChange }: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === value) ?? null,
    [products, value],
  );
  const filteredProducts = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return products;
    return products.filter((product) =>
      `${product.name} ${product.code}`.toLocaleLowerCase().includes(search),
    );
  }, [products, query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredProducts.findIndex((product) => product.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredProducts, open, value]);

  const chooseProduct = (product: ProductOption) => {
    onChange(product.id);
    setOpen(false);
    setQuery("");
  };

  const moveActive = (direction: 1 | -1) => {
    if (!open) setOpen(true);
    if (filteredProducts.length === 0) return;
    setActiveIndex((current) => (current + direction + filteredProducts.length) % filteredProducts.length);
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex min-h-[46px] w-full items-center gap-2 rounded-lg border bg-white px-2 shadow-sm transition ${
          open ? "border-ink-700 ring-2 ring-brand-pink/25" : "border-ink-300 hover:border-ink-400"
        }`}
      >
        {selectedProduct && <ProductThumbnail product={selectedProduct} />}
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && filteredProducts[activeIndex] ? `${listboxId}-${filteredProducts[activeIndex].id}` : undefined}
          value={open ? query : selectedProduct?.name ?? ""}
          placeholder={open ? `Search ${products.length} coded products…` : "Search products…"}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActive(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(-1);
            } else if (event.key === "Enter" && open && filteredProducts[activeIndex]) {
              event.preventDefault();
              chooseProduct(filteredProducts[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            } else if (event.key === "Tab") {
              setOpen(false);
              setQuery("");
            }
          }}
        />
        {selectedProduct && !open && <span className="tag shrink-0">{selectedProduct.code}</span>}
        <span aria-hidden="true" className={`mr-1 text-xs text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </div>

      {open && (
        <div className="menu-pop absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card-hover">
          <div id={listboxId} role="listbox" aria-label="Coded products" className="max-h-80 overflow-y-auto p-1.5">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, index) => {
                const selected = product.id === value;
                const active = index === activeIndex;
                return (
                  <button
                    key={product.id}
                    id={`${listboxId}-${product.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                      active ? "bg-brand-pink/10" : "hover:bg-ink-100"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseProduct(product)}
                  >
                    <ProductThumbnail product={product} size="large" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{product.name}</span>
                      <span className="mt-0.5 block text-xs text-ink-500">Product code {product.code}</span>
                    </span>
                    <span className={`tag shrink-0 ${selected ? "border-brand-pink/40 bg-brand-pink/10 text-ink-900" : ""}`}>{product.code}</span>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-ink-800">No coded products found</p>
                <p className="mt-1 text-xs text-ink-500">Try a product name or code such as V1 or FLOW.</p>
              </div>
            )}
          </div>
          <div className="border-t border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-500">
            {filteredProducts.length} {filteredProducts.length === 1 ? "product" : "products"} · Search by name or code
          </div>
        </div>
      )}
    </div>
  );
}
