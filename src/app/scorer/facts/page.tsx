import type { Metadata } from "next";
import Link from "next/link";
import { requireStrategist } from "@/lib/authorization";
import type { BrandFactRow, MarketProfileRow, ProductOfferRow, ProductRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { FactsOffersManager } from "./FactsOffersManager";

export const metadata: Metadata = { title: "Facts and Offers · Script Scorer" };
export const dynamic = "force-dynamic";

export default async function ScorerFactsPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  await requireStrategist();
  const query = await searchParams;
  const [productsResult, marketsResult] = await Promise.all([
    supabase.from("Product").select("*").order("name"),
    supabase.from("MarketProfile").select("*").order("code"),
  ]);
  const error = productsResult.error ?? marketsResult.error;
  if (error) throw new Error(error.message);
  const products = (productsResult.data ?? []) as ProductRow[];
  const requestedProduct = products.find((product) => product.id === query.product);
  const selectedProductId = requestedProduct?.id ?? products[0]?.id ?? "";
  const [factsResult, offersResult] = selectedProductId
    ? await Promise.all([
        supabase.from("BrandFact").select("*").eq("productId", selectedProductId).order("updatedAt", { ascending: false }),
        supabase.from("ProductOffer").select("*").eq("productId", selectedProductId).order("updatedAt", { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const evidenceError = factsResult.error ?? offersResult.error;
  if (evidenceError) throw new Error(evidenceError.message);

  return (
    <div className="space-y-6">
      <header>
        <Link href="/scorer" className="text-sm text-ink-500 hover:text-ink-900">← Script Scorer</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Approved facts and offers</h1><span className="tag tag-warn">product evidence</span></div>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">Record source-backed product claims and exact commercial terms. Only approved, currently applicable records are used by the scorer.</p>
      </header>
      <FactsOffersManager
        key={selectedProductId}
        products={products.map((row) => ({ id: row.id, name: row.name }))}
        markets={(marketsResult.data as MarketProfileRow[]).map((row) => ({ code: row.code.toUpperCase(), name: row.name }))}
        facts={(factsResult.data ?? []) as BrandFactRow[]}
        offers={(offersResult.data ?? []) as ProductOfferRow[]}
        initialProductId={selectedProductId}
      />
    </div>
  );
}
