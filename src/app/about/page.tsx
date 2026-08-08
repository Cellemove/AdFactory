import Link from "next/link";

export const metadata = {
  title: "About · CelluMove Ad Factory",
  description: "What the Ad Factory is, how the pipeline works, and the guardrails that keep it honest.",
};

const STAGES: { code: string; title: string; desc: string }[] = [
  { code: "G1", title: "Avatar Excavation", desc: "Real customer voice mined from the web — her actual words." },
  { code: "G2", title: "Avatar Deep Dive", desc: "Grounded Reddit research — real threads, exact quotes, pattern-level insight." },
  { code: "G3", title: "Root Cause & Mechanism", desc: "The villains, the unique mechanism, the belief work and proof." },
  { code: "DNA", title: "Brand DNA", desc: "How CelluMove shows up in this funnel — positioning, voice, do/don't-say." },
  { code: "G4", title: "Copy Arsenal", desc: "A reusable bank of big ideas, headlines, hooks, and objection crushers." },
  { code: "G5", title: "Advertorial", desc: "A native-style article that carries her from problem-aware to ready-to-buy." },
  { code: "G6", title: "Ad Scripts & Copy", desc: "Ready-to-shoot video scripts plus Meta primary text and headlines." },
  { code: "G7", title: "Creative Briefs", desc: "Shoot/design-ready briefs an editor could execute without you." },
];

const TOOLS: { href: string; label: string; desc: string }[] = [
  { href: "/research", label: "Research", desc: "Mine angles, sub-avatars, and concepts from real customer voice." },
  { href: "/spy", label: "Spy", desc: "A live feed of competitor 3D-shaping legging ads, verified for dead links." },
  { href: "/pipeline", label: "Pipeline", desc: "The gated G1→G7 build for one avatar, run a stage at a time or all at once." },
  { href: "/avatars", label: "Avatars", desc: "The angle + sub-avatar library every run draws from." },
  { href: "/winners", label: "Winners", desc: "Proven ads worth iterating on." },
  { href: "/knowledge", label: "Knowledge", desc: "Editable SOPs the agents obey on the next run." },
];

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">About</h1>
        <p className="text-sm text-ink-500">
          CelluMove Ad Factory turns real customer voice into production-ready ad creative — research
          to scripts — for CelluMove 3D-shaping compression leggings.
        </p>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">What it is</h2>
        <div className="divider" />
        <p className="text-sm text-ink-700">
          A research → strategy → creative engine. It listens to how real people talk about their
          problem, distills that into avatars and angles, then runs a structured pipeline that builds
          everything from the root-cause story to shoot-ready ad scripts. The whole point is creative
          grounded in what customers actually say — not generic marketing language.
        </p>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">How the pipeline works</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Eight stages, each building on the ones above it. Run them one at a time, or{" "}
          <Link href="/pipeline" className="underline hover:text-ink-900">all at once</Link>.
        </p>
        <div className="divider" />
        <ol className="space-y-2">
          {STAGES.map((s) => (
            <li key={s.code} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-md bg-ink-900 px-1.5 text-xs font-semibold text-white">
                {s.code}
              </span>
              <div>
                <div className="text-sm font-medium text-ink-900">{s.title}</div>
                <div className="text-xs text-ink-500">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Guardrails — keeping it honest</h2>
        <div className="divider" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Anti-hallucination</div>
            <p className="mt-1 text-sm text-ink-700">
              AI-generated research is verified, not trusted. Every cited source is checked for
              liveness (including soft-404s), and quotes are matched against the real page they came
              from. Unverified sources and quotes are flagged, not shipped.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Compliance</div>
            <p className="mt-1 text-sm text-ink-700">
              This is a medical-adjacent niche. A deterministic claim scan flags cure/overclaim and
              medical-promise language in generated copy so a human gates it before it goes live.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Around the app</h2>
        <div className="divider" />
        <ul className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                className="block rounded-md border border-ink-200 bg-white p-3 transition hover:border-ink-900 hover:bg-ink-50"
              >
                <div className="text-sm font-medium text-ink-900">{t.label}</div>
                <div className="text-xs text-ink-500">{t.desc}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Under the hood</h2>
        <div className="divider" />
        <p className="text-sm text-ink-700">
          Next.js (App Router) · React · Supabase/Postgres · Gemini 2.5 Pro on Vertex AI (grounded
          with Google Search + URL context) · Tailwind. The agents read editable{" "}
          <Link href="/knowledge" className="underline hover:text-ink-900">SOPs</Link>, so house rules
          change behavior without a code change.
        </p>
      </section>
    </div>
  );
}
