import Link from "next/link";

const TABS = [
  { key: "overview", href: "/miner", label: "Overview" },
  { key: "run", href: "/miner/run", label: "Run pipeline" },
] as const;

export function MinerTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Corpus Miner" className="inline-flex rounded-full border border-ink-200 bg-white/70 p-1 shadow-card backdrop-blur">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition duration-200 ${tab.key === active ? "bg-ink-900 text-white shadow-sm" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
