"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { BrandFactRow, ProductOfferRow } from "@/lib/database.types";
import { createBrandFact, createProductOffer, setFactOrOfferStatus } from "./actions";

type ProductOption = { id: string; name: string };
type MarketOption = { code: string; name: string };
type EvidenceStatus = "draft" | "approved" | "retired";

export function FactsOffersManager({ products, markets, facts, offers }: { products: ProductOption[]; markets: MarketOption[]; facts: BrandFactRow[]; offers: ProductOfferRow[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [kind, setKind] = useState<"fact" | "offer">("fact");
  const [marketCode, setMarketCode] = useState("");
  const [type, setType] = useState("");
  const [statement, setStatement] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<EvidenceStatus>("draft");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedProduct = products.find((product) => product.id === productId);
  const productFacts = useMemo(() => facts.filter((row) => row.productId === productId), [facts, productId]);
  const productOffers = useMemo(() => offers.filter((row) => row.productId === productId), [offers, productId]);

  const save = () => startTransition(async () => {
    setMessage(null);
    try {
      if (kind === "fact") await createBrandFact({ productId, marketCode: marketCode || null, factType: type, statement, sourceUrl: sourceUrl || null, status });
      else await createProductOffer({ productId, marketCode: marketCode || null, offerType: type, statement, sourceUrl: sourceUrl || null, status, validFrom: validFrom || null, validUntil: validUntil || null });
      setType(""); setStatement(""); setSourceUrl(""); setValidFrom(""); setValidUntil(""); setStatus("draft");
      setMessage(`${kind === "fact" ? "Fact" : "Offer"} saved.`);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  });

  const changeStatus = (recordKind: "fact" | "offer", id: string, nextStatus: EvidenceStatus) => startTransition(async () => {
    setMessage(null);
    try { await setFactOrOfferStatus({ kind: recordKind, id, status: nextStatus }); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  });

  if (!products.length) return <div className="card text-sm text-ink-500">Create a product before adding facts or offers.</div>;

  return (
    <div className="space-y-6">
      <section className="card">
        <label className="max-w-xl"><span className="label">Product scope</span><select className="input" value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <p className="mt-2 text-xs text-ink-500">The scorer will use approved records for {selectedProduct?.name ?? "this product"} when the market and offer dates also match.</p>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Add product evidence</h2><p className="mt-1 text-xs text-ink-500">Approval requires a source URL. Use draft while a claim is still being checked.</p></div><div className="flex rounded-full border border-ink-200 p-1"><button type="button" className={`rounded-full px-3 py-1 text-sm ${kind === "fact" ? "bg-ink-900 text-white" : "text-ink-600"}`} onClick={() => setKind("fact")}>Fact</button><button type="button" className={`rounded-full px-3 py-1 text-sm ${kind === "offer" ? "bg-ink-900 text-white" : "text-ink-600"}`} onClick={() => setKind("offer")}>Offer</button></div></div>
        <div className="grid gap-4 md:grid-cols-3">
          <label><span className="label">{kind === "fact" ? "Fact type" : "Offer type"}</span><input className="input" value={type} onChange={(event) => setType(event.target.value)} placeholder={kind === "fact" ? "materials, mechanism, usage…" : "price, guarantee, bundle…"} /></label>
          <label><span className="label">Market</span><select className="input" value={marketCode} onChange={(event) => setMarketCode(event.target.value)}><option value="">All markets</option>{markets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.name}</option>)}</select></label>
          <label><span className="label">Initial status</span><select className="input" value={status} onChange={(event) => setStatus(event.target.value as EvidenceStatus)}><option value="draft">Draft</option><option value="approved">Approved</option></select></label>
        </div>
        <label><span className="label">Exact supported statement</span><textarea className="input min-h-24" value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Write one atomic, checkable claim or offer per record." /></label>
        <label><span className="label">Source URL</span><input className="input" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label>
        {kind === "offer" && <div className="grid gap-4 md:grid-cols-2"><label><span className="label">Valid from</span><input type="date" className="input" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label><span className="label">Valid until</span><input type="date" className="input" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label></div>}
        <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn btn-primary" disabled={pending || !productId || !type.trim() || !statement.trim()} onClick={save}>{pending ? "Saving…" : `Save ${kind}`}</button>{message && <p role="status" className="text-sm text-ink-600">{message}</p>}</div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <EvidenceList title="Brand facts" kind="fact" rows={productFacts} pending={pending} onStatus={changeStatus} />
        <EvidenceList title="Product offers" kind="offer" rows={productOffers} pending={pending} onStatus={changeStatus} />
      </div>
    </div>
  );
}

function EvidenceList({ title, kind, rows, pending, onStatus }: { title: string; kind: "fact" | "offer"; rows: Array<BrandFactRow | ProductOfferRow>; pending: boolean; onStatus: (kind: "fact" | "offer", id: string, status: EvidenceStatus) => void }) {
  return <section className="card"><div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2><span className="tag">{rows.length}</span></div><div className="divider" />{rows.length ? <ul className="space-y-3">{rows.map((row) => <li key={row.id} className="rounded-xl border border-ink-200 p-3"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap gap-1.5"><span className={row.status === "approved" ? "tag tag-ok" : row.status === "retired" ? "tag" : "tag tag-warn"}>{row.status}</span><span className="tag">{row.marketCode ?? "all markets"}</span><span className="tag">{"factType" in row ? row.factType : row.offerType}</span></div><p className="mt-2 text-sm">{row.statement}</p>{row.sourceUrl ? <a className="mt-2 inline-block text-xs underline" href={row.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : <p className="mt-2 text-xs text-amber-700">No source URL</p>}</div><select aria-label={`Status for ${row.statement}`} className="input w-auto shrink-0 text-xs" disabled={pending} value={row.status} onChange={(event) => onStatus(kind, row.id, event.target.value as EvidenceStatus)}><option value="draft">Draft</option><option value="approved">Approved</option><option value="retired">Retired</option></select></div></li>)}</ul> : <p className="text-sm text-ink-500">No {title.toLowerCase()} for this product.</p>}</section>;
}
