import Link from "next/link";
import { supabase } from "@/lib/db";
import type { SopRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

// The agent roster. Mirrors the roles in lib/cellumove/agents.ts + the pipeline
// stages in actions/pipeline.ts. `deepDive` lists what each agent now consumes
// from the structured Avatar Deep Dive profile (see lib/cellumove/avatar-profile.ts).
type RoleScope = "strategist" | "copywriter" | "researcher" | "designer" | "compliance";

interface AgentInfo {
  scope: RoleScope;
  name: string;
  kind: "llm" | "deterministic";
  stage: string;
  does: string;
  features: string[]; // usage tags it records under
  deepDive: string[]; // what it reads from the profile
}

const AGENTS: AgentInfo[] = [
  {
    scope: "researcher",
    name: "Researcher",
    kind: "llm",
    stage: "Research (/research)",
    does:
      "Mines real customer voice — Reddit/Quora/forums via grounded search + url-context — and synthesizes sub-avatars, angles, and concepts. Produces the structured deep dive.",
    features: ["sub_avatar_research", "angle_research", "concept_research"],
    deepDive: [
      "Follows the deep-dive template as its section spec + quality bar",
      "Fetched Reddit verbatims are injected as source material",
      "Outputs the full profile (voice, desires, buyer psychology, angle candidates…)",
    ],
  },
  {
    scope: "strategist",
    name: "Creative Strategist",
    kind: "llm",
    stage: "Pipeline · Stage 1",
    does:
      "The orchestrator. Decides angle, core message, hook direction, and which proof to use — one strategic brief per reference format. Hands off to the copywriter.",
    features: ["pipeline_strategist"],
    deepDive: [
      "Primary emotion + scored buying emotions (guilt, trust…)",
      "Top hesitation + counter-strategy",
      "Ranked desires (scope×urgency×staying-power) & angle candidates (Ev+Ma+Ws)",
      "Strongest of the Big 4",
    ],
  },
  {
    scope: "copywriter",
    name: "Copywriter",
    kind: "llm",
    stage: "Pipeline · Stage 2 (+ corrective pass)",
    does:
      "Turns each brief into a shootable script with 3 distinct hook mechanics. Speaks the avatar's language; honours the claims guardrail.",
    features: ["pipeline_copywriter", "pipeline_copywriter_fix"],
    deepDive: [
      "Voice profile + power words + exact phrases-to-use",
      "HARD BAN on the avatar's rejected clichés",
      "Register, sentence & punctuation rules",
      "Pain/desire ratio + the hook bridge + real verbatims to mine",
    ],
  },
  {
    scope: "compliance",
    name: "Compliance",
    kind: "deterministic",
    stage: "Pipeline · Stage 3",
    does:
      "Not an LLM — a deterministic gate. Runs the engine's claim gates + market-forbidden claims, then triggers one corrective copywriter pass on anything flagged.",
    features: [],
    deepDive: [
      "Resonance gate: flags the avatar's rejected clichés in the script",
      "So the corrective pass rewrites them into her own phrasing",
    ],
  },
  {
    scope: "designer",
    name: "Visual Designer",
    kind: "llm",
    stage: "Pipeline · Stage 4",
    does:
      "Turns finished scripts into shootable plans — B-roll per beat, a UGC creator brief, and the clips we'd still need to shoot.",
    features: ["pipeline_designer"],
    deepDive: [
      "Proven concept directions per angle",
      "Trust signals (what makes her believe)",
      "Identification (self-image, what she wants to look like)",
    ],
  },
];

export default async function AgentsPage() {
  const res = await supabase
    .from("Sop")
    .select("*")
    .order("pinned", { ascending: false })
    .order("order", { ascending: true });
  const sopsAvailable = !res.error;
  const sops = (res.data ?? []) as SopRow[];

  // SOPs an agent reads = its own scope + the global "all" scope.
  const sopsForScope = (scope: RoleScope) =>
    sops.filter((s) => s.roleScope === scope || s.roleScope === "all");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-ink-500">
          The roster behind every run. Each agent reads the{" "}
          <Link href="/knowledge" className="underline hover:text-ink-900">SOPs</Link>{" "}
          scoped to its role and the structured{" "}
          <Link href="/avatars" className="underline hover:text-ink-900">avatar deep dive</Link>,
          then makes one Gemini call. Write a SOP and the matching agent obeys it on the next run.
        </p>
      </header>

      {/* Pipeline flow */}
      <section className="card">
        <h2 className="text-sm font-semibold">Pipeline flow</h2>
        <div className="divider" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {["Researcher", "Strategist", "Copywriter", "Compliance", "Designer"].map((step, i, arr) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-md bg-ink-100 px-2.5 py-1 font-medium text-ink-800">{step}</span>
              {i < arr.length - 1 && <span className="text-ink-400">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          The Researcher feeds the avatar library; Strategist → Compliance → Designer run per script
          generation. Compliance loops back to the Copywriter for one corrective pass when it flags issues.
        </p>
      </section>

      {!sopsAvailable && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          The SOP table isn&apos;t set up yet — agents run on their built-in rules. Run the
          migration + <code className="font-mono">npm run seed:sop</code> to enable editable SOPs.
        </div>
      )}

      <section className="space-y-3">
        {AGENTS.map((a) => {
          const roleSops = sopsForScope(a.scope);
          return (
            <div key={a.scope} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-ink-900">{a.name}</h2>
                  <span className={`tag ${a.kind === "llm" ? "tag-ok" : ""}`}>
                    {a.kind === "llm" ? "LLM agent" : "deterministic"}
                  </span>
                </div>
                <span className="text-xs font-medium text-ink-500">{a.stage}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-600">{a.does}</p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Reads from the deep dive
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm text-ink-700">
                    {a.deepDive.map((d, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-ink-400">•</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Standing SOPs
                    </span>
                    {sopsAvailable && (
                      <span className="text-xs text-ink-400">{roleSops.length}</span>
                    )}
                  </div>
                  {!sopsAvailable ? (
                    <p className="mt-1 text-sm text-ink-400">—</p>
                  ) : roleSops.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-400">
                      None yet — runs on built-in rules.{" "}
                      <Link href="/knowledge" className="underline hover:text-ink-700">Write one →</Link>
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-sm text-ink-700">
                      {roleSops.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                          {s.pinned && <span className="tag tag-ok text-[10px]">pinned</span>}
                          <span>{s.title}</span>
                          {s.roleScope === "all" && <span className="text-xs text-ink-400">(global)</span>}
                          {s.marketScope && (
                            <span className="text-xs text-ink-400">[{s.marketScope}]</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {a.features.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2">
                  <span className="text-xs text-ink-400">records usage as</span>
                  {a.features.map((f) => (
                    <code key={f} className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-600">
                      {f}
                    </code>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
