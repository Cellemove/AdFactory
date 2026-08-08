import { supabase, unwrap } from "@/lib/db";
import { HOOK_MECHANICS } from "@/lib/cellumove/formats";
import { BigSwingsClient } from "./BigSwingsClient";

export const dynamic = "force-dynamic";

export default async function BigSwingsPage() {
  const res = await supabase.from("BigSwing").select("*").order("order", { ascending: true });
  const swings = unwrap(res);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Big Swings library</h1>
        <p className="text-sm text-ink-500">12 formats × 12 hook mechanics. Pick one in the wizard&apos;s Big-Swing lane.</p>
      </header>

      <BigSwingsClient
        swings={swings.map((s) => {
          let headlines: string[] = [];
          try {
            const parsed = JSON.parse(s.headlineOptions);
            if (Array.isArray(parsed)) headlines = parsed.filter((h): h is string => typeof h === "string");
          } catch { /* */ }
          return {
            id: s.id,
            slug: s.slug,
            name: s.name,
            funnel: s.funnel,
            description: s.description,
            visualSpec: s.visualSpec,
            headlines,
          };
        })}
      />

      <section>
        <h2 className="text-sm font-semibold">Hook mechanics ({HOOK_MECHANICS.length})</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {HOOK_MECHANICS.map((h) => (
            <div key={h.slug} className="card">
              <div className="text-sm font-semibold">{h.name}</div>
              <p className="mt-0.5 text-xs text-ink-500">{h.description}</p>
              <p className="mt-2 font-mono text-xs text-ink-700">&ldquo;{h.example}&rdquo;</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
