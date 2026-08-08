import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

function fetchPage(from: number, to: number) {
  return supabase.from("Usage").select("*").order("createdAt", { ascending: false }).range(from, to);
}

const FEATURE_LABEL: Record<string, string> = {
  generation: "Static prompt generation",
  video_generation: "Video script generation",
  sub_avatar_research: "Sub-avatar research",
  angle_research: "Angle research",
  concept_research: "Concept research",
  extraction: "Winner image extraction",
};

export default async function UsagePage() {
  // Pull ALL rows by paging — PostgREST caps any single response at 1,000 rows
  // regardless of .limit(), which silently truncated these totals once the table
  // passed 1k calls. Page in 1k chunks (hard safety cap 50k).
  const PAGE = 1000;
  const all: NonNullable<Awaited<ReturnType<typeof fetchPage>>["data"]> = [];
  let error: { message: string } | null = null;
  for (let from = 0; from < 50_000; from += PAGE) {
    const res = await fetchPage(from, from + PAGE - 1);
    if (res.error) {
      error = res.error;
      break;
    }
    const chunk = res.data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE) break; // last page
  }
  const res = { data: all, error };

  if (res.error) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-ink-500">Google Cloud / Gemini token spend.</p>
        </header>
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The Usage table doesn&apos;t exist yet — see the SQL migration in chat to create it.
          Once it&apos;s in, each Gemini call records a row here automatically.
        </div>
      </div>
    );
  }
  const rows = res.data ?? [];

  // Aggregates
  const total = rows.reduce(
    (acc, r) => {
      acc.calls += 1;
      acc.input += r.inputTokens ?? 0;
      acc.output += r.outputTokens ?? 0;
      acc.thinking += r.thinkingTokens ?? 0;
      acc.cost += Number(r.estimatedCostUsd ?? 0);
      return acc;
    },
    { calls: 0, input: 0, output: 0, thinking: 0, cost: 0 },
  );

  const byFeature = new Map<string, { calls: number; cost: number; input: number; output: number; thinking: number }>();
  for (const r of rows) {
    const f = byFeature.get(r.feature) ?? { calls: 0, cost: 0, input: 0, output: 0, thinking: 0 };
    f.calls += 1;
    f.cost += Number(r.estimatedCostUsd ?? 0);
    f.input += r.inputTokens ?? 0;
    f.output += r.outputTokens ?? 0;
    f.thinking += r.thinkingTokens ?? 0;
    byFeature.set(r.feature, f);
  }

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = (r.createdAt ?? "").slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(r.estimatedCostUsd ?? 0));
  }
  const last14 = Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14);
  const maxDailyCost = Math.max(0.0001, ...last14.map(([, c]) => c));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-ink-500">
          Gemini 2.5 Pro on Vertex AI. Cost is estimated using published Vertex prices —
          your actual GCP bill is authoritative.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total calls" value={total.calls.toLocaleString()} />
        <Stat label="Estimated cost" value={`$${total.cost.toFixed(4)}`} />
        <Stat label="Input tokens" value={fmt(total.input)} />
        <Stat label="Output + thinking" value={fmt(total.output + total.thinking)} />
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">By feature (all time)</h2>
        <div className="divider" />
        {byFeature.size === 0 ? (
          <p className="text-sm text-ink-500">No calls recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2">Feature</th>
                <th className="py-2 text-right">Calls</th>
                <th className="py-2 text-right">Input</th>
                <th className="py-2 text-right">Output+thinking</th>
                <th className="py-2 text-right">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(byFeature.entries())
                .sort((a, b) => b[1].cost - a[1].cost)
                .map(([feature, f]) => (
                  <tr key={feature} className="border-b border-ink-100">
                    <td className="py-1.5">{FEATURE_LABEL[feature] ?? feature}</td>
                    <td className="py-1.5 text-right">{f.calls.toLocaleString()}</td>
                    <td className="py-1.5 text-right">{fmt(f.input)}</td>
                    <td className="py-1.5 text-right">{fmt(f.output + f.thinking)}</td>
                    <td className="py-1.5 text-right">${f.cost.toFixed(4)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Last 14 days</h2>
        <p className="mt-0.5 text-xs text-ink-500">Daily estimated cost (UTC).</p>
        <div className="divider" />
        {last14.length === 0 ? (
          <p className="text-sm text-ink-500">No spend yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {last14.map(([day, cost]) => (
              <li key={day} className="flex items-center gap-3 text-xs">
                <span className="w-24 shrink-0 font-mono text-ink-500">{day}</span>
                <span className="flex-1">
                  <span
                    className="block h-2 rounded-sm bg-ink-900"
                    style={{ width: `${(cost / maxDailyCost) * 100}%`, minWidth: "2px" }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums">${cost.toFixed(4)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Recent calls</h2>
        <p className="mt-0.5 text-xs text-ink-500">The last 30 Gemini invocations.</p>
        <div className="divider" />
        {rows.length === 0 ? (
          <p className="text-sm text-ink-500">No calls recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {rows.slice(0, 30).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-ink-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                <span className="flex-1">{FEATURE_LABEL[r.feature] ?? r.feature}</span>
                <span className="tabular-nums text-ink-600">
                  {fmt(r.inputTokens)} in · {fmt(r.outputTokens + r.thinkingTokens)} out
                </span>
                <span className="w-20 text-right tabular-nums">${Number(r.estimatedCostUsd ?? 0).toFixed(4)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
