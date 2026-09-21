import Link from "next/link";
import type { BrandPlaybook, PlaybookBeat, PlaybookExample, PlaybookShare } from "@/lib/cellumove/corpus/playbook";

const pct = (share: number) => `${Math.round(share * 100)}%`;
const sec = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(0)}s`);

const LAYER_NAME: Record<string, string> = { H: "Hooks", Q: "Qualify", P: "Pain", B: "Belief", M: "Mechanism", PR: "Proof", O: "Offer", OTHER: "Other" };
const LAYER_ORDER = ["Q", "P", "B", "M", "PR", "O", "OTHER"];

function SectionTitle({ index, title, hint }: { index: number; title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">{index}</span>
      <div>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <p className="text-xs text-ink-500">{hint}</p>
      </div>
    </div>
  );
}

/** One real moment from an ad: what was said, what was on screen, what the shot was. */
function Example({ example }: { example: PlaybookExample }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-2.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono tabular-nums text-ink-400">{example.tStart != null ? `${example.tStart.toFixed(0)}–${(example.tEnd ?? example.tStart).toFixed(0)}s` : "—"}</span>
        <Link href={`/miner/${example.adId}`} className="font-mono text-[10px] text-ink-400 hover:text-ink-700 hover:underline">{example.adId}</Link>
      </div>
      <p className="mt-1 text-sm italic text-ink-900">“{example.quote}”</p>
      <dl className="mt-1.5 space-y-0.5 text-ink-600">
        {example.onScreen && <div><dt className="inline font-medium text-ink-500">TEXT: </dt><dd className="inline">{example.onScreen}</dd></div>}
        {example.visual && <div><dt className="inline font-medium text-ink-500">VISUAL: </dt><dd className="inline">{example.visual}</dd></div>}
      </dl>
    </div>
  );
}

function BeatCard({ beat }: { beat: PlaybookBeat }) {
  return (
    <article className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-ink-900">{beat.label}</h3>
          <p className="mt-0.5 text-xs text-ink-500">{beat.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-white px-2 py-0.5 font-semibold tabular-nums text-ink-700 ring-1 ring-ink-200">{pct(beat.share)} of ads</span>
          {beat.medianStartSec != null && <span className="rounded-full bg-white px-2 py-0.5 tabular-nums text-ink-500 ring-1 ring-ink-200">from {sec(beat.medianStartSec)}</span>}
          {beat.medianDurationSec != null && <span className="rounded-full bg-white px-2 py-0.5 tabular-nums text-ink-500 ring-1 ring-ink-200">~{sec(beat.medianDurationSec)} long</span>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {beat.examples.map((example) => <Example key={`${example.adId}-${example.tStart}`} example={example} />)}
      </div>
    </article>
  );
}

function ShareBars({ title, items, empty }: { title: string; items: PlaybookShare[]; empty: string }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-400">{title}</h3>
      {items.length === 0 ? <p className="mt-2 text-sm text-ink-500">{empty}</p> : (
        <ul className="mt-2 space-y-2.5">
          {items.map((item) => (
            <li key={item.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-ink-900">{item.name}</span>
                <span className="tabular-nums text-ink-500">{item.ads} ads · {pct(item.share)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-pink to-ink-800" style={{ width: pct(item.share) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlaybookView({ playbook, generatedAt }: { playbook: BrandPlaybook; generatedAt: string }) {
  const layers = LAYER_ORDER.map((layer) => ({ layer, beats: playbook.beats.filter((beat) => beat.layer === layer) })).filter((group) => group.beats.length);
  return (
    <article className="space-y-8">
      <header className="card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-brand-blush/70 via-white to-white px-5 py-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-500">Brand playbook</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink-900">{playbook.brand}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {playbook.adCount} winning ads · {playbook.selection}{playbook.medianDurationSec != null && <> · typical length {sec(playbook.medianDurationSec)}</>} · written {new Date(generatedAt).toLocaleDateString()}
          </p>
          <dl className="mt-4 flex flex-wrap gap-2">
            {playbook.copy.tone.map((stat) => (
              <div key={stat.key} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs" title={stat.note}>
                <dt className="inline text-ink-500">{stat.label}: </dt>
                <dd className="inline font-semibold text-ink-900">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {playbook.caveats.length > 0 && (
          <ul className="border-t border-amber-200 bg-amber-50/70 px-5 py-3 text-xs text-amber-900">
            {playbook.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        )}
      </header>

      <section className="card space-y-4">
        <SectionTitle index={1} title="The spine" hint={playbook.researchMode === "speech_only" ? "The observed spoken-copy sequence, with speech timing. Unseen content may add other beats." : "The sequence this brand's winning ads follow most often, with the typical window for each beat."} />
        {playbook.spine ? (
          <>
            <ol className="flex flex-wrap items-stretch gap-1.5">
              {playbook.spine.steps.map((step, index) => (
                <li key={`${step.code}-${index}`} className="flex items-center gap-1.5">
                  <span className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs">
                    <span className="block text-[10px] uppercase tracking-wide text-ink-400">{LAYER_NAME[step.layer] ?? step.layer}</span>
                    <span className="block font-medium text-ink-900">{step.label}</span>
                    <span className="block tabular-nums text-ink-400">{step.window ? `${step.window[0].toFixed(0)}–${step.window[1].toFixed(0)}s` : "—"}</span>
                  </span>
                  {index < playbook.spine!.steps.length - 1 && <span aria-hidden className="text-ink-300">→</span>}
                </li>
              ))}
            </ol>
            <p className="text-xs text-ink-500">{playbook.spine.ads} of {playbook.adCount} ads follow this order ({pct(playbook.spine.share)}).</p>
          </>
        ) : <p className="text-sm text-ink-500">No spine yet — the pattern report for this brand has not been mined.</p>}
        {playbook.laws.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-3">
            {playbook.laws.map((law) => (
              <li key={law.law} className="rounded-xl bg-ink-50 px-3 py-2.5 text-sm">
                <p className="text-ink-800">{law.law}</p>
                <p className="mt-0.5 text-xs font-semibold tabular-nums text-ink-500">{pct(law.share)} of ads</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4">
        <SectionTitle index={2} title="Hooks" hint={playbook.researchMode === "speech_only" ? "Opening spoken lines. Visual hooks have not been assessed." : "How the first seconds open, with the real lines, on-screen text and shots."} />
        {playbook.hooks.length ? <div className="space-y-3">{playbook.hooks.map((beat) => <BeatCard key={beat.code} beat={beat} />)}</div> : <p className="text-sm text-ink-500">No hook used by enough ads yet.</p>}
      </section>

      <section className="card space-y-4">
        <SectionTitle index={3} title="Copywriting rules" hint="What this brand keeps doing in the words — each rule with the share of ads that follow it and real proofs." />
        {playbook.copy.rules.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {playbook.copy.rules.map((rule) => (
              <li key={rule.key} className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-ink-900">{rule.rule}</p>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-700 ring-1 ring-ink-200">{pct(rule.share)} of ads</span>
                </div>
                <p className="mt-1 text-sm text-ink-500">{rule.how}</p>
                <div className="mt-2 space-y-1">
                  {rule.examples.map((example) => (
                    <p key={`${example.adId}-${example.tStart}`} className="border-l-2 border-ink-200 pl-2.5 text-sm italic text-ink-700">
                      {example.text} <Link href={`/miner/${example.adId}`} className="not-italic font-mono text-[10px] text-ink-400 hover:underline">{example.tStart != null ? `${example.tStart.toFixed(0)}s` : ""}</Link>
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-500">No rule is followed by enough ads yet.</p>}
        {playbook.copy.signatureWords.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-400">Words they keep using</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {playbook.copy.signatureWords.map((word) => <span key={word.term} className="tag">{word.term} <span className="ml-1 text-ink-400">{word.ads}</span></span>)}
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <SectionTitle index={4} title="Formats & concepts" hint="How the ads are made, and the big idea each one hangs on." />
        <div className="grid gap-6 md:grid-cols-2">
          <ShareBars title="Formats" items={playbook.formats} empty="No format tags yet." />
          <ShareBars title="Concepts" items={playbook.concepts} empty="No concept tags yet." />
        </div>
      </section>

      <section className="card space-y-5">
        <SectionTitle index={5} title="Beat library" hint="Every beat this brand uses, by layer: how often, where in the ad, how long, and how it is executed." />
        {layers.map((group) => (
          <div key={group.layer} className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-700">{LAYER_NAME[group.layer] ?? group.layer}</h3>
            {group.beats.map((beat) => <BeatCard key={beat.code} beat={beat} />)}
          </div>
        ))}
        {!layers.length && <p className="text-sm text-ink-500">No beats reach the support threshold yet.</p>}
      </section>

      <footer className="card bg-ink-50/60 text-sm text-ink-600">
        <span className="font-medium text-ink-900">How to use it:</span> pick a format and the spine, keep the copywriting rules and the beat executions, and write the ad for our own avatar in this voice.
      </footer>
    </article>
  );
}
