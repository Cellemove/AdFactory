import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { latestBrandPlaybook, listPlaybookBrands } from "@/lib/cellumove/corpus/playbook.server";
import { MinerTabs } from "../MinerTabs";
import { PlaybookView } from "./PlaybookView";

export const metadata: Metadata = { title: "Playbook · Corpus Miner · AdFactory" };
export const dynamic = "force-dynamic";

export default async function PlaybookPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  await requireUser();
  const { brand } = await searchParams;
  const brands = await listPlaybookBrands().catch(() => []);
  const selected = brand ?? brands[0]?.brand ?? null;
  const latest = selected ? await latestBrandPlaybook(selected).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MinerTabs active="playbook" />
        {brands.length > 0 && (
          <nav aria-label="Brands with a playbook" className="flex flex-wrap gap-1.5 text-xs">
            {brands.map((item) => (
              <Link key={item.brand} href={`/miner/playbook?brand=${encodeURIComponent(item.brand)}`} className={item.brand === selected ? "tag tag-ok" : "tag"}>
                {item.brand} · {item.adCount}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {latest ? (
        <PlaybookView playbook={latest.playbook} generatedAt={latest.row.createdAt} />
      ) : (
        <div className="card py-12 text-center">
          <h1 className="text-lg font-semibold text-ink-900">No playbook yet</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            {selected
              ? `${selected} has no playbook. Run the pipeline for it — the playbook is the last step.`
              : "Pick a competitor on the Run pipeline page and run it. The playbook is written as the last step."}
          </p>
          <Link href={selected ? `/miner?brand=${encodeURIComponent(selected)}` : "/miner"} className="btn btn-primary mt-4">Go to Run pipeline</Link>
        </div>
      )}
    </div>
  );
}
