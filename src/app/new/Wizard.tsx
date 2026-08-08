"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createBriefAndRun, type CreateBriefAndRunInput } from "../actions/runs";
import { researchSubAvatars, saveResearchedSubAvatar, type ResearchedAvatarDraft } from "../actions/research";
import { VerificationBadges } from "../research/DraftCards";
import { HOOK_MECHANICS } from "@/lib/cellumove/formats";

type AngleLite = { id: string; slug: string; name: string };
type SubAvatarLite = {
  id: string;
  slug: string;
  name: string;
  shortDesc: string | null;
  angleSlug: string;
  hasResearch: boolean;
};
type WinnerLite = {
  id: string;
  adName: string;
  headline: string;
  angleSlug: string;
  funnel: string;
  adType: string;
  hookType: string | null;
};
type BigSwingLite = {
  id: string;
  slug: string;
  name: string;
  format: string;
  funnel: string;
  description: string;
  visualSpec: string;
  headlineOptions: string[];
};

interface Props {
  apiConfigured: boolean;
  angles: AngleLite[];
  subAvatars: SubAvatarLite[];
  winners: WinnerLite[];
  bigSwings: BigSwingLite[];
  defaultTargetCount: number;
}

type Lane = "iterate" | "big_swing" | "ai_research";
type AdType = "static" | "video";
type SubAvatarMode = "pick" | "skip" | "research";
type StepName = "Output" | "Angle" | "Sub-avatar" | "Research" | "Lane" | "Generate";

interface FormState {
  angleSlug: string;
  subAvatarId: string;
  subAvatarMode: SubAvatarMode;
  researchFocus: string;
  adType: AdType;
  lane: Lane;
  parentWinnerId: string;
  iterationVar: string;
  hypothesis: string;
  bigSwingId: string;
  hookMechanic: string;
  conceptResearchFocus: string;
}

const ITERATION_VARS = [
  "hook",
  "headline",
  "visual",
  "cta",
  "casting",
  "composition",
  "color/contrast",
] as const;

export function Wizard(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState<number>(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    angleSlug: "",
    subAvatarId: "",
    subAvatarMode: "pick",
    researchFocus: "",
    adType: "static",
    lane: "iterate",
    parentWinnerId: "",
    iterationVar: "hook",
    hypothesis: "",
    bigSwingId: "",
    hookMechanic: "",
    conceptResearchFocus: "",
  });

  // Research-step ephemeral state (not part of FormState — wizard-scoped only).
  const [researchDrafts, setResearchDrafts] = useState<ResearchedAvatarDraft[] | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const angleSubs = useMemo(
    () => props.subAvatars.filter((s) => s.angleSlug === form.angleSlug),
    [props.subAvatars, form.angleSlug],
  );
  // Iterate lane filters winners by adType too — a static run should only adapt
  // static winners; a video run only video winners.
  const angleWinners = useMemo(
    () =>
      props.winners.filter(
        (w) => w.angleSlug === form.angleSlug && w.adType === form.adType,
      ),
    [props.winners, form.angleSlug, form.adType],
  );

  const selectedSub = props.subAvatars.find((s) => s.id === form.subAvatarId);

  // Dynamic step list — Output (static/video) first, then angle/sub-avatar/lane/generate.
  // Research appears only in research mode.
  const stepDefs = useMemo<StepName[]>(
    () => [
      "Output",
      "Angle",
      "Sub-avatar",
      ...(form.subAvatarMode === "research" ? (["Research"] as const) : []),
      "Lane",
      "Generate",
    ],
    [form.subAvatarMode],
  );
  // Keep `step` in range when stepDefs length changes (e.g. user toggles research mode).
  const currentStepName = stepDefs[Math.min(step, stepDefs.length - 1)];
  const clampedStep = Math.min(step, stepDefs.length - 1);

  const runResearch = () => {
    if (!form.angleSlug) return;
    setResearchError(null);
    setIsResearching(true);
    setResearchDrafts(null);
    startTransition(async () => {
      try {
        const drafts = await researchSubAvatars(form.angleSlug, form.researchFocus || null);
        setResearchDrafts(drafts);
      } catch (e) {
        setResearchError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsResearching(false);
      }
    });
  };

  const pickResearchDraft = (draft: ResearchedAvatarDraft) => {
    setResearchError(null);
    setIsSavingDraft(true);
    startTransition(async () => {
      try {
        const { subAvatarId } = await saveResearchedSubAvatar({
          angleSlug: form.angleSlug,
          draft,
        });
        setForm((f) => ({ ...f, subAvatarId }));
        // Advance to Lane.
        const laneIdx = stepDefs.indexOf("Lane");
        if (laneIdx !== -1) setStep(laneIdx);
      } catch (e) {
        setResearchError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSavingDraft(false);
      }
    });
  };

  const canAdvance = (() => {
    switch (currentStepName) {
      case "Output":
        return true;
      case "Angle":
        return Boolean(form.angleSlug);
      case "Sub-avatar":
        if (form.subAvatarMode === "skip") return true;
        if (form.subAvatarMode === "research") return true; // advance into Research step
        return Boolean(form.subAvatarId) && Boolean(selectedSub?.hasResearch);
      case "Research":
        // Advance only when a draft is picked (which sets subAvatarId AND auto-advances to Lane).
        return Boolean(form.subAvatarId);
      case "Lane":
        if (form.lane === "iterate") {
          return Boolean(form.parentWinnerId);
        }
        if (form.lane === "ai_research") {
          return true; // research focus is optional
        }
        // Big-swing: for static you must pick a BigSwing format; for video any format is fine
        return form.adType === "video" ? true : Boolean(form.bigSwingId);
      case "Generate":
        return true;
      default:
        return false;
    }
  })();

  const submit = () => {
    setError(null);
    const payload: CreateBriefAndRunInput = {
      angleSlug: form.angleSlug,
      subAvatarId: form.subAvatarMode === "skip" ? null : form.subAvatarId,
      lane: form.lane,
      adType: form.adType,
      parentWinnerId: form.lane === "iterate" ? form.parentWinnerId : null,
      iterationVar: form.lane === "iterate" ? form.iterationVar : null,
      hypothesis: form.lane === "iterate" ? form.hypothesis : null,
      bigSwingId: form.lane === "big_swing" ? form.bigSwingId : null,
      hookMechanic: form.lane === "big_swing" ? form.hookMechanic || null : null,
      conceptResearchFocus: form.lane === "ai_research" ? form.conceptResearchFocus || null : null,
    };
    startTransition(async () => {
      try {
        const res = await createBriefAndRun(payload);
        router.push(`/runs/${res.runId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
          <p className="text-sm text-ink-500">{stepDefs.length} steps from output type to prompts. The engine invents the hook, headline, and visual concept for each prompt.</p>
        </div>
        {!props.apiConfigured && (
          <span className="tag tag-warn">No API key — run will save brief only</span>
        )}
      </header>

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {stepDefs.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 ${
                i === clampedStep ? "bg-ink-900 text-white" : i < clampedStep ? "bg-emerald-100 text-emerald-700" : "bg-ink-200 text-ink-600"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === clampedStep ? "font-medium text-ink-900" : "text-ink-500"}>{label}</span>
            {i < stepDefs.length - 1 && <span className="text-ink-300">›</span>}
          </li>
        ))}
      </ol>

      <div className="card">
        {currentStepName === "Output" && (
          <StepOutput value={form.adType} onChange={(v) => update("adType", v)} />
        )}
        {currentStepName === "Angle" && (
          <StepAngle angles={props.angles} value={form.angleSlug} onChange={(v) => update("angleSlug", v)} />
        )}
        {currentStepName === "Sub-avatar" && (
          <StepSubAvatar
            angleSlug={form.angleSlug}
            subs={angleSubs}
            value={form.subAvatarId}
            onChange={(v) => update("subAvatarId", v)}
            mode={form.subAvatarMode}
            onModeChange={(m) => {
              update("subAvatarMode", m);
              // Clear stale picked id when switching modes
              if (m !== "pick") update("subAvatarId", "");
              if (m !== "research") {
                setResearchDrafts(null);
                setResearchError(null);
              }
            }}
            focus={form.researchFocus}
            onFocusChange={(v) => update("researchFocus", v)}
          />
        )}
        {currentStepName === "Research" && (
          <StepResearch
            angleName={props.angles.find((a) => a.slug === form.angleSlug)?.name ?? form.angleSlug}
            focus={form.researchFocus}
            onFocusChange={(v) => update("researchFocus", v)}
            drafts={researchDrafts}
            isResearching={isResearching}
            isSavingDraft={isSavingDraft}
            error={researchError}
            onRun={runResearch}
            onPick={pickResearchDraft}
          />
        )}
        {currentStepName === "Lane" && (
          <StepLane
            adType={form.adType}
            setAdType={(v) => update("adType", v)}
            lane={form.lane}
            setLane={(l) => update("lane", l)}
            winners={angleWinners}
            bigSwings={props.bigSwings}
            parentWinnerId={form.parentWinnerId}
            setParentWinnerId={(v) => update("parentWinnerId", v)}
            iterationVar={form.iterationVar}
            setIterationVar={(v) => update("iterationVar", v)}
            hypothesis={form.hypothesis}
            setHypothesis={(v) => update("hypothesis", v)}
            bigSwingId={form.bigSwingId}
            setBigSwingId={(v) => update("bigSwingId", v)}
            hookMechanic={form.hookMechanic}
            setHookMechanic={(v) => update("hookMechanic", v)}
            conceptResearchFocus={form.conceptResearchFocus}
            setConceptResearchFocus={(v) => update("conceptResearchFocus", v)}
          />
        )}
        {currentStepName === "Generate" && (
          <StepGenerate form={form} winners={props.winners} bigSwings={props.bigSwings} />
        )}
      </div>

      {error && (
        <div className="card border-red-300 bg-red-50 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          className="btn"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={clampedStep === 0 || isPending}
        >
          ← Back
        </button>
        <div className="text-xs text-ink-500">Step {clampedStep + 1} of {stepDefs.length}</div>
        {clampedStep < stepDefs.length - 1 ? (
          <button
            className="btn btn-primary"
            onClick={() => setStep((s) => Math.min(stepDefs.length - 1, s + 1))}
            disabled={!canAdvance}
          >
            Next →
          </button>
        ) : (
          <button className="btn btn-primary" onClick={submit} disabled={isPending}>
            {isPending ? "Generating…" : "Generate prompts"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step: Output (static vs video) ──────────────────────────────────────────
function StepOutput({ value, onChange }: { value: AdType; onChange: (v: AdType) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Pick the output format</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Static = 9-section image prompts for Nano Banana Pro / Higgsfield. Video = scripts with 2-3 hook variants + 6-beat storyboard
          (HOOK → AFTER-HOOK → BODY 1-3 → CTA). The rest of the wizard adapts to what you pick here.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange("static")}
          className={`rounded-md border p-5 text-left transition ${value === "static" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
        >
          <div className="text-sm font-semibold">Static ad prompts</div>
          <div className={`mt-1 text-xs ${value === "static" ? "text-ink-200" : "text-ink-500"}`}>
            9-section image-gen prompts. Best when you want a batch of still-image ad concepts.
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChange("video")}
          className={`rounded-md border p-5 text-left transition ${value === "video" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
        >
          <div className="text-sm font-semibold">Video ad scripts</div>
          <div className={`mt-1 text-xs ${value === "video" ? "text-ink-200" : "text-ink-500"}`}>
            Hook variants + 6-beat storyboard (time × visual × on-screen text × VO × SFX × BGM). Mixes easy / medium / hard production levels across the batch.
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Step: Angle ─────────────────────────────────────────────────────────────
function StepAngle({ angles, value, onChange }: {
  angles: AngleLite[];
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">Pick an angle</h2>
      <p className="mt-0.5 text-xs text-ink-500">The 7 hardcoded angles. Each has its own mechanism, silhouette, and colorway.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {angles.map((a) => (
          <button
            key={a.slug}
            type="button"
            onClick={() => onChange(a.slug)}
            className={`rounded-md border p-3 text-left text-sm transition ${
              value === a.slug ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"
            }`}
          >
            <div className="font-medium">{a.name}</div>
            <div className={`text-xs ${value === a.slug ? "text-ink-200" : "text-ink-500"}`}>{a.slug}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step: Sub-avatar ────────────────────────────────────────────────────────
function StepSubAvatar({
  angleSlug, subs, value, onChange, mode, onModeChange, focus, onFocusChange,
}: {
  angleSlug: string;
  subs: SubAvatarLite[];
  value: string;
  onChange: (id: string) => void;
  mode: SubAvatarMode;
  onModeChange: (m: SubAvatarMode) => void;
  focus: string;
  onFocusChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Sub-avatar</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Pick one, skip for a generic audience, or have AI research candidates from the web.
          </p>
        </div>
        <Link href={`/avatars?angle=${angleSlug}&new=1`} className="btn">+ New sub-avatar</Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ModeCard
          active={mode === "pick"}
          onClick={() => onModeChange("pick")}
          title="Pick existing"
          desc="Use a sub-avatar you've already added (must have research)."
        />
        <ModeCard
          active={mode === "skip"}
          onClick={() => onModeChange("skip")}
          title="Skip (generic)"
          desc="Quick tests or angle-wide concepts. No research injected."
        />
        <ModeCard
          active={mode === "research"}
          onClick={() => onModeChange("research")}
          title="Research from web"
          desc="Gemini searches Reddit, Quora, forums via Google. ~30–60s, ~$0.10."
        />
      </div>

      {mode === "pick" && (
        subs.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
            No sub-avatars under this angle yet. <Link className="underline" href={`/avatars?angle=${angleSlug}&new=1`}>Create one</Link> — or switch to Skip / Research above.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {subs.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onChange(s.id)}
                  className={`flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition ${
                    value === s.id ? "border-ink-900 bg-ink-100" : "border-ink-200 bg-white hover:border-ink-900"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.shortDesc && <div className="mt-0.5 text-xs text-ink-500">{s.shortDesc}</div>}
                  </div>
                  {s.hasResearch ? (
                    <span className="tag tag-ok">research ✓</span>
                  ) : (
                    <Link href={`/avatars/${s.slug}`} className="tag tag-danger">no research — add</Link>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {mode === "skip" && (
        <p className="mt-4 rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
          Sub-avatar selection is disabled. Click Next to continue with a generic angle-level audience.
        </p>
      )}

      {mode === "research" && (
        <div className="mt-4 space-y-2">
          <label className="label">Optional focus (helps narrow the search)</label>
          <input
            className="input"
            placeholder='e.g. "post-pregnancy moms 30-40" or "night-shift nurses"'
            value={focus}
            onChange={(e) => onFocusChange(e.target.value)}
          />
          <p className="text-xs text-ink-500">
            Click Next to run research and see candidates.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition ${active ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className={`mt-0.5 text-xs ${active ? "text-ink-200" : "text-ink-500"}`}>{desc}</div>
    </button>
  );
}

// ─── Step: Research (conditional) ────────────────────────────────────────────
function StepResearch({
  angleName, focus, onFocusChange, drafts, isResearching, isSavingDraft, error, onRun, onPick,
}: {
  angleName: string;
  focus: string;
  onFocusChange: (v: string) => void;
  drafts: ResearchedAvatarDraft[] | null;
  isResearching: boolean;
  isSavingDraft: boolean;
  error: string | null;
  onRun: () => void;
  onPick: (d: ResearchedAvatarDraft) => void;
}) {
  const showInitial = drafts === null && !isResearching;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Web research for {angleName}</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Gemini searches the open web (Reddit, Quora, Relevant TikTok & Youtube Comments) via Google Search grounding and synthesizes 3–4 candidate sub-avatars. Pick one to use for this run — it's also saved to /avatars for reuse.
        </p>
      </div>

      <div className="grid-fields">
        <div className="sm:col-span-2">
          <label className="label">Optional focus</label>
          <input
            className="input"
            placeholder='e.g. "post-pregnancy moms 30-40"'
            value={focus}
            onChange={(e) => onFocusChange(e.target.value)}
            disabled={isResearching || isSavingDraft}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRun}
          disabled={isResearching || isSavingDraft}
        >
          {isResearching ? "Researching… (30–60s)" : drafts ? "Research again" : "Run research"}
        </button>
        {drafts && !isResearching && (
          <span className="text-xs text-ink-500">{drafts.length} candidate{drafts.length === 1 ? "" : "s"}</span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {isResearching && (
        <div className="rounded-md border border-dashed border-ink-300 bg-ink-50 p-6 text-center text-sm text-ink-500">
          Gemini is searching the web and synthesizing sub-avatars… this typically takes 30–60s.
        </div>
      )}

      {showInitial && (
        <p className="rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
          Click <strong>Run research</strong> above to fetch candidates.
        </p>
      )}

      {drafts && drafts.length > 0 && !isResearching && (
        <ul className="space-y-3">
          {drafts.map((d, i) => (
            <li key={i} className="rounded-md border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{d.name}</span>
                    <VerificationBadges v={d.verification} />
                  </div>
                  {d.shortDesc && <div className="mt-0.5 text-xs text-ink-500">{d.shortDesc}</div>}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onPick(d)}
                  disabled={isSavingDraft}
                >
                  {isSavingDraft ? "Saving…" : "Use this avatar"}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <DraftField label="Pain points" value={d.painPoints} />
                <DraftField label="Desires" value={d.desires} />
                <DraftField label="Triggers" value={d.triggers} />
                <DraftField label="Daily language" value={d.dailyLanguage} />
              </div>
              {d.sources?.length > 0 && (
                <div className="mt-3 text-xs text-ink-500">
                  <span className="font-medium">Sources:</span>{" "}
                  {d.sources.slice(0, 3).map((s, j) => (
                    <span key={j}>
                      <a href={s} target="_blank" rel="noreferrer" className="underline hover:text-ink-900">[{j + 1}]</a>{" "}
                    </span>
                  ))}
                  {d.sources.length > 3 && <span>+{d.sources.length - 3} more</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {drafts && drafts.length === 0 && !isResearching && (
        <p className="rounded-md border border-dashed border-ink-300 p-4 text-sm text-ink-500">
          No candidates returned. Try adjusting the focus and re-running.
        </p>
      )}
    </div>
  );
}

function DraftField({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-ink-700">{value}</div>
    </div>
  );
}

// ─── Step: Lane ──────────────────────────────────────────────────────────────
// Same lane concept (iterate vs big-swing) for both static and video — but the
// downstream fields differ. Static iterate asks for an iteration variable + a
// hypothesis (one-variable-change discipline); video iterate skips those since
// the variation lives in the production levels across the batch. Static big-swing
// picks a specific BigSwing format from the library; video big-swing has no such
// library — the engine varies production format itself, so we only collect an
// optional hook mechanic.
function StepLane(props: {
  adType: AdType;
  setAdType: (v: AdType) => void;
  lane: Lane;
  setLane: (l: Lane) => void;
  winners: WinnerLite[];
  bigSwings: BigSwingLite[];
  parentWinnerId: string;
  setParentWinnerId: (v: string) => void;
  iterationVar: string;
  setIterationVar: (v: string) => void;
  hypothesis: string;
  setHypothesis: (v: string) => void;
  bigSwingId: string;
  setBigSwingId: (v: string) => void;
  hookMechanic: string;
  setHookMechanic: (v: string) => void;
  conceptResearchFocus: string;
  setConceptResearchFocus: (v: string) => void;
}) {
  const isVideo = props.adType === "video";
  // adType + setAdType are passed through but the toggle now lives on its own
  // Output step at the start of the wizard. Reference them so TS doesn't warn.
  void props.setAdType;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Pick a lane</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          {isVideo
            ? "Adapt a winner, write fresh original scripts, or let Gemini research what's working right now and base scripts on those findings."
            : "Iterate exploits a winner. Big Swing explores a new format. AI Researched grounds the prompts in live web search."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => props.setLane("iterate")}
          className={`rounded-md border p-4 text-left transition ${props.lane === "iterate" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
        >
          <div className="text-sm font-semibold">{isVideo ? "Adapt a winner" : "Iterate"}</div>
          <div className={`text-xs ${props.lane === "iterate" ? "text-ink-200" : "text-ink-500"}`}>
            {isVideo
              ? "Take a winning ad and rebuild it as 4-5 video iterations across production levels."
              : "One variable change off a winner."}
          </div>
        </button>
        <button
          type="button"
          onClick={() => props.setLane("big_swing")}
          className={`rounded-md border p-4 text-left transition ${props.lane === "big_swing" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
        >
          <div className="text-sm font-semibold">{isVideo ? "Original concept" : "Big Swing"}</div>
          <div className={`text-xs ${props.lane === "big_swing" ? "text-ink-200" : "text-ink-500"}`}>
            {isVideo
              ? "Fresh video scripts with no winner reference. Engine varies hook mechanics + production levels."
              : "Brand-new format or hook mechanic."}
          </div>
        </button>
        <button
          type="button"
          onClick={() => props.setLane("ai_research")}
          className={`rounded-md border p-4 text-left transition ${props.lane === "ai_research" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white hover:border-ink-900"}`}
        >
          <div className="text-sm font-semibold">AI Researched concept</div>
          <div className={`text-xs ${props.lane === "ai_research" ? "text-ink-200" : "text-ink-500"}`}>
            Gemini Google-Search-grounds first — finds what's working now for this angle/audience — then generates from those findings, with sources.
          </div>
        </button>
      </div>

      {props.lane === "iterate" && (
        <div className="space-y-4">
          <div>
            <label className="label">{isVideo ? "Winning ad to adapt" : "Parent winning ad"}</label>
            {props.winners.length === 0 ? (
              <p className="rounded-md border border-dashed border-ink-300 p-3 text-sm text-ink-500">
                No winners in this angle. <Link className="underline" href="/winners">Add one.</Link>
              </p>
            ) : (
              <select className="input" value={props.parentWinnerId} onChange={(e) => props.setParentWinnerId(e.target.value)}>
                <option value="">— Select winner —</option>
                {props.winners.map((w) => (
                  <option key={w.id} value={w.id}>{w.adName} · {w.funnel}</option>
                ))}
              </select>
            )}
          </div>
          {!isVideo && (
            <div className="grid-fields">
              <div>
                <label className="label">Variable to change (one only)</label>
                <select className="input" value={props.iterationVar} onChange={(e) => props.setIterationVar(e.target.value)}>
                  {ITERATION_VARS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Hypothesis</label>
                <input
                  className="input"
                  placeholder="e.g. tightening the hook will lift CTR by 30%"
                  value={props.hypothesis}
                  onChange={(e) => props.setHypothesis(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {props.lane === "big_swing" && (
        <div className="space-y-4">
          {!isVideo && (
            <div>
              <label className="label">Big-Swing format</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {props.bigSwings.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => props.setBigSwingId(b.id)}
                    className={`rounded-md border p-3 text-left text-sm transition ${props.bigSwingId === b.id ? "border-ink-900 bg-ink-100" : "border-ink-200 bg-white hover:border-ink-900"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{b.name}</span>
                      <span className="tag">{b.funnel}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{b.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="label">Hook mechanic (optional)</label>
            <select className="input" value={props.hookMechanic} onChange={(e) => props.setHookMechanic(e.target.value)}>
              <option value="">— none —</option>
              {HOOK_MECHANICS.map((h) => (
                <option key={h.slug} value={h.slug}>{h.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {props.lane === "ai_research" && (
        <div className="space-y-3 rounded-md border border-dashed border-ink-300 bg-ink-50 p-4">
          <div>
            <label className="label">Research focus (optional)</label>
            <input
              className="input"
              placeholder="e.g. 'post-pregnancy moms searching for cellulite solutions on TikTok'"
              value={props.conceptResearchFocus}
              onChange={(e) => props.setConceptResearchFocus(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-500">
              Narrows the search. Leave blank to let Gemini cast wide across the angle + sub-avatar context.
            </p>
          </div>
          <p className="text-xs text-ink-600">
            On submit, the engine runs Google-Search-grounded queries to find current winning {isVideo ? "video script patterns" : "ad concepts"} for
            this angle and audience, then generates {isVideo ? "video scripts" : "prompts"} informed by those findings. Sources are included with each output.
            Generation takes ~30-60s longer than non-grounded runs.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step: Generate ──────────────────────────────────────────────────────────
function StepGenerate({ form, winners, bigSwings }: { form: FormState; winners: WinnerLite[]; bigSwings: BigSwingLite[] }) {
  const parent = winners.find((w) => w.id === form.parentWinnerId);
  const swing = bigSwings.find((b) => b.id === form.bigSwingId);
  const derivedFunnel =
    form.lane === "iterate"
      ? parent?.funnel ?? "—"
      : form.lane === "big_swing"
        ? swing?.funnel ?? "MOFU"
        : "MOFU";
  const laneLabel =
    form.lane === "iterate"
      ? form.adType === "video" ? "Adapt a winner" : "Iterate"
      : form.lane === "big_swing"
        ? form.adType === "video" ? "Original concept" : "Big Swing"
        : "AI Researched concept";
  const subAvatarLabel =
    form.subAvatarMode === "skip"
      ? "skipped (generic)"
      : form.subAvatarMode === "research"
        ? `AI-researched (${form.subAvatarId || "—"})`
        : form.subAvatarId || "—";
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-sm font-semibold">Review & generate</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          The engine will compose hook, headline, and visual concept per prompt — using the angle, sub-avatar research, and lane context below.
        </p>
      </div>
      <dl className="grid-fields">
        <Row label="Angle" value={form.angleSlug} />
        <Row label="Sub-avatar" value={subAvatarLabel} />
        <Row label="Output" value={form.adType === "video" ? "Video ad scripts" : "Static ad prompts"} />
        <Row label="Lane" value={laneLabel} />
        <Row label="Funnel" value={derivedFunnel} />
        {form.lane === "iterate" && (
          <>
            <Row label="Parent winner" value={parent?.adName ?? "—"} />
            {form.adType === "static" && (
              <>
                <Row label="Variable" value={form.iterationVar} />
                <Row label="Hypothesis" value={form.hypothesis} wide />
              </>
            )}
          </>
        )}
        {form.lane === "big_swing" && (
          <>
            {form.adType === "static" && (
              <Row label="Big swing format" value={swing?.name ?? "—"} />
            )}
            <Row label="Hook mechanic" value={form.hookMechanic || "—"} />
          </>
        )}
        {form.lane === "ai_research" && (
          <Row label="Research focus" value={form.conceptResearchFocus || "(none — broad search)"} wide />
        )}
      </dl>
      <p className="text-xs text-ink-500">
        On submit: the engine generates prompts (count defaults from settings), the 10 compliance gates run per prompt, and you land on the run page to mark verdicts.
      </p>
    </div>
  );
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="label">{label}</dt>
      <dd className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm">{value || "—"}</dd>
    </div>
  );
}
