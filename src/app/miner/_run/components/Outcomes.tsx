import Link from "next/link";
import type { BrandSummary } from "../types";
import { ArrowIcon, SparkIcon } from "./icons";

/**
 * What a run actually gives you, said once at the top. Someone opening this page
 * cold should know what they get before they spend anything.
 */
export function Outcomes({ brand, hasPlaybook }: { brand: BrandSummary; hasPlaybook: boolean }) {
  const items = [
    {
      title: "Their playbook",
      body: "How their ads are built and written: the structure with timings, their hooks, their formats and big ideas, and the copywriting rules they follow — each with real lines from their ads.",
      href: hasPlaybook ? `/miner/playbook?brand=${encodeURIComponent(brand.domain)}` : null,
      cta: "Open the playbook",
      primary: true,
    },
    {
      title: "The numbers",
      body: "Every ad broken into its parts, with the exact words and timecodes, plus what repeats across them all.",
      href: brand.extracted > 0 ? `/miner/results?cohort=${encodeURIComponent(`brand:${brand.domain}`)}` : null,
      cta: "See the numbers",
      primary: false,
    },
    {
      title: "Deep-dives",
      body: "A full written analysis of their strongest ads, with a scene-by-scene script you can copy.",
      href: brand.teardownsDone > 0 ? `/miner/results?cohort=${encodeURIComponent(`brand:${brand.domain}`)}` : null,
      cta: "Read the deep-dives",
      primary: false,
    },
  ];

  return (
    <section aria-label="What you get" className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <article key={item.title} className={`card flex flex-col justify-between gap-3 ${item.primary ? "border-brand-pink/30 bg-gradient-to-br from-brand-blush/40 via-white to-white" : ""}`}>
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              {item.primary && <SparkIcon className="h-3.5 w-3.5 text-brand-pink" />}{item.title}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{item.body}</p>
          </div>
          {item.href
            ? <Link href={item.href} className="inline-flex items-center gap-1 text-xs font-medium text-ink-900 hover:underline">{item.cta} <ArrowIcon className="h-3.5 w-3.5" /></Link>
            : <span className="text-xs text-ink-400">Ready once this brand has been run</span>}
        </article>
      ))}
    </section>
  );
}
