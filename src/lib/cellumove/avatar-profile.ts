// The structured Avatar Deep Dive profile — the persisted shape behind the
// `deep_dive_template` quality bar. Stored JSON-stringified in
// AvatarResearch.profile. Everything is OPTIONAL: research fills what it finds,
// and the pipeline reads what's present. Parse with `parseAvatarProfile`, which
// strips unknown keys and never throws.
//
// Mirrors the high-value sections of the gold-standard deep dive, scoped to what
// the strategist / copywriter / designer / compliance gates actually consume.

import { z } from "zod";

// One mined quote, labelled by evidence tier.
const VerbatimItem = z.object({
  tier: z.enum(["verbatim", "reconstructed"]).optional(),
  text: z.string(),
  source: z.string().optional(), // subreddit / forum / url
}).passthrough();

const Big4Entry = z.object({
  applicable: z.boolean().optional(),
  angle: z.string().optional(),
});

// Scores are nominally 0-10 but kept as plain numbers so an out-of-range value
// the model occasionally emits doesn't fail the parse — consumers clamp at read time.
const ScoreNum = z.number();

export const AvatarProfileSchema = z.object({
  voiceProfile: z.object({
    register: z.string().optional(),
    humorStyle: z.string().optional(),
    cursingLevel: z.string().optional(),
    emotionalTone: z.string().optional(),
    formalityLevel: z.number().optional(),
  }).partial().optional(),

  vocabulary: z.object({
    powerWords: z.array(z.string()).optional(),
    phrasesToUse: z.array(z.string()).optional(),
    // Resonance blocks — marketing clichés this avatar rejects. Distinct from the
    // legal/compliance cure-language blocks; fed to the copywriter AND a compliance gate.
    forbiddenWords: z.array(z.string()).optional(),
    registerRules: z.array(z.string()).optional(),
  }).partial().optional(),

  sentencePatterns: z.object({
    structures: z.array(z.string()).optional(),
    typicalLength: z.string().optional(),
    punctuationHabits: z.string().optional(),
  }).partial().optional(),

  emotionalRegister: z.object({
    peak: z.string().optional(),
    baseline: z.string().optional(),
    suppressed: z.string().optional(),
    primaryEmotion: z.string().optional(),
  }).partial().optional(),

  metaphors: z.array(z.object({
    image: z.string(),
    whyResonates: z.string().optional(),
  })).optional(),

  bridgeToMechanism: z.object({
    beliefGaps: z.string().optional(),
    howSheTalksAboutCause: z.string().optional(),
    hookBridge: z.string().optional(),
  }).partial().optional(),

  deepDesires: z.array(z.object({
    surface: z.string().optional(),
    middle: z.string().optional(),
    core: z.string().optional(),
    massInstinct: z.string().optional(), // HEALTH/SURVIVAL | STATUS | SEX/RELATIONSHIPS | COMFORT | CONTROL | BELONGING
    connectionChain: z.string().optional(),
    copyAngle: z.string().optional(),
    scope: z.number().optional(),
    urgency: z.number().optional(),
    stayingPower: z.number().optional(),
  })).optional(),

  big4: z.object({
    bigFast: Big4Entry.optional(),
    newOnly: Big4Entry.optional(),
    easyAnybody: Big4Entry.optional(),
    safePredictable: Big4Entry.optional(),
    strongest: z.string().optional(),
  }).partial().optional(),

  angleCandidates: z.array(z.object({
    name: z.string(),
    ev: z.number().optional(), // emotional voltage
    ma: z.number().optional(), // mass-instinct match
    ws: z.number().optional(), // winning-signal (filmable + specific)
    exampleHook: z.string().optional(),
    reasonToBuy: z.string().optional(),
    emotionalLever: z.string().optional(),
    conceptDirections: z.array(z.string()).optional(),
  })).optional(),

  languageMining: z.object({
    pain: z.array(VerbatimItem).optional(),
    desire: z.array(VerbatimItem).optional(),
    identity: z.array(VerbatimItem).optional(),
    actionCoping: z.array(VerbatimItem).optional(),
    bodySensation: z.array(VerbatimItem).optional(),
    emotionalState: z.array(VerbatimItem).optional(),
    failedSolution: z.array(VerbatimItem).optional(),
  }).partial().optional(),

  trust: z.object({
    trustSignals: z.array(z.string()).optional(),
    skepticismObjections: z.array(z.string()).optional(),
    failedSolutions: z.array(z.string()).optional(),
  }).partial().optional(),

  triggers: z.object({
    triggerMoments: z.array(z.string()).optional(),
    desireCalendar: z.object({
      peakMonths: z.array(z.string()).optional(),
      seasonalAngles: z.array(z.object({
        month: z.string().optional(),
        angle: z.string().optional(),
      })).optional(),
    }).partial().optional(),
  }).partial().optional(),

  identification: z.object({
    selfImageToPortray: z.string().optional(),
    whereTheyWantToBe: z.string().optional(),
    whatTheyWantToFeel: z.string().optional(),
    whatTheyWantToLookLike: z.string().optional(),
  }).partial().optional(),

  buyerPsychology: z.object({
    buyerVsUser: z.string().optional(),
    buyingEmotions: z.object({
      fear: ScoreNum.optional(),
      guilt: ScoreNum.optional(),
      pride: ScoreNum.optional(),
      shame: ScoreNum.optional(),
      trust: ScoreNum.optional(),
      excitement: ScoreNum.optional(),
    }).partial().optional(),
    painDesireRatio: z.object({
      painPct: z.number().optional(),
      desirePct: z.number().optional(),
      copyImplication: z.string().optional(),
    }).partial().optional(),
    purchaseHesitation: z.string().optional(),
    counterStrategy: z.string().optional(),
  }).partial().optional(),
}).partial();

export type AvatarProfile = z.infer<typeof AvatarProfileSchema>;

// Parse loosely: accepts an object or a JSON string, strips unknowns, never throws.
// Returns null when there's nothing usable.
export function parseAvatarProfile(raw: unknown): AvatarProfile | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return null;
    }
  }
  // Fast path: the whole object validates.
  const whole = AvatarProfileSchema.safeParse(obj);
  if (whole.success) {
    return Object.keys(whole.data).length ? whole.data : null;
  }
  // Resilient path: validate each section independently so one malformed section
  // (a stray type, an odd value) drops alone instead of discarding the deep dive.
  if (typeof obj !== "object" || obj === null) return null;
  const shape = AvatarProfileSchema.shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (!(key in (obj as Record<string, unknown>))) continue;
    const section = shape[key].safeParse((obj as Record<string, unknown>)[key]);
    if (section.success && section.data !== undefined) out[key] = section.data;
  }
  return Object.keys(out).length ? (out as AvatarProfile) : null;
}

// ─── Prompt rendering for the pipeline ───────────────────────────────────────
// Each renderer turns the structured profile into a labelled prompt block tailored
// to one agent. All are guard-heavy and return "" when there's nothing to say, so
// callers can append unconditionally. Profile fields are all optional by design.

const clampScore = (n: number) => Math.max(0, Math.min(10, Math.round(n)));
const bullets = (arr?: string[]) =>
  (arr ?? []).map((s) => (s || "").trim()).filter(Boolean);

/** The avatar's resonance-block list — marketing clichés this person rejects.
 *  Consumed by both the copywriter (don't write them) and the compliance gate. */
export function avatarForbiddenWords(profile: AvatarProfile | null | undefined): string[] {
  const raw = bullets(profile?.vocabulary?.forbiddenWords).map((w) => w.toLowerCase());
  return [...new Set(raw)];
}

/** Voice + language rules + the verbatim well — what makes the script sound like HER. */
export function renderCopywriterProfile(profile: AvatarProfile | null | undefined): string {
  if (!profile) return "";
  const out: string[] = [];
  const v = profile.voiceProfile;
  if (v && (v.register || v.emotionalTone || v.humorStyle || v.cursingLevel || v.formalityLevel != null)) {
    out.push("VOICE: " + [
      v.register && `register=${v.register}`,
      v.emotionalTone && `tone=${v.emotionalTone}`,
      v.humorStyle && `humor=${v.humorStyle}`,
      v.cursingLevel && `cursing=${v.cursingLevel}`,
      v.formalityLevel != null && `formality=${v.formalityLevel}/5`,
    ].filter(Boolean).join(" · "));
  }
  const power = bullets(profile.vocabulary?.powerWords);
  if (power.length) out.push(`POWER WORDS (reach for these): ${power.join(", ")}`);
  const phrases = bullets(profile.vocabulary?.phrasesToUse);
  if (phrases.length) out.push("PHRASES TO USE (echo these near-verbatim):\n" + phrases.map((p) => `  • ${p}`).join("\n"));
  const forbidden = bullets(profile.vocabulary?.forbiddenWords);
  if (forbidden.length) out.push(`HARD BAN — these clichés trigger rejection, never write them: ${forbidden.join(", ")}`);
  const rules = bullets(profile.vocabulary?.registerRules);
  if (rules.length) out.push("REGISTER RULES:\n" + rules.map((r) => `  • ${r}`).join("\n"));
  const sp = profile.sentencePatterns;
  if (sp && (sp.structures?.length || sp.typicalLength || sp.punctuationHabits)) {
    out.push("SENTENCE PATTERNS: " + [
      sp.structures?.length && `structures: ${bullets(sp.structures).join(" / ")}`,
      sp.typicalLength && `length: ${sp.typicalLength}`,
      sp.punctuationHabits && `punctuation: ${sp.punctuationHabits}`,
    ].filter(Boolean).join(" · "));
  }
  const pdr = profile.buyerPsychology?.painDesireRatio;
  if (pdr && (pdr.painPct != null || pdr.copyImplication)) {
    out.push(`PAIN/DESIRE: ${pdr.painPct ?? "?"}% pain / ${pdr.desirePct ?? "?"}% desire${pdr.copyImplication ? ` — ${pdr.copyImplication}` : ""}`);
  }
  const bridge = profile.bridgeToMechanism?.hookBridge;
  if (bridge) out.push(`HOOK BRIDGE (move her from false belief to mechanism): ${bridge}`);
  // A handful of real verbatims, the highest-value buckets first.
  const lm = profile.languageMining;
  if (lm) {
    const pick = (items?: { text: string; tier?: string }[], n = 3): string[] =>
      (items ?? []).map((i) => i?.text).filter((t): t is string => Boolean(t)).slice(0, n);
    const candidates: [string, string[]][] = [
      ["pain", pick(lm.pain)],
      ["desire", pick(lm.desire)],
      ["identity", pick(lm.identity)],
      ["emotional", pick(lm.emotionalState)],
    ];
    const groups = candidates.filter(([, arr]) => arr.length);
    if (groups.length) {
      out.push("REAL VERBATIMS (mine these for hooks — her actual words):\n" +
        groups.map(([k, arr]) => `  [${k}] ${arr.map((t) => `"${t}"`).join(" · ")}`).join("\n"));
    }
  }
  if (!out.length) return "";
  return ["", "── AVATAR VOICE & LANGUAGE (write in HER voice) ──", ...out].join("\n");
}

/** Buyer psychology, ranked desires, ranked angle candidates — the strategic levers. */
export function renderStrategistProfile(profile: AvatarProfile | null | undefined): string {
  if (!profile) return "";
  const out: string[] = [];
  const primary = profile.emotionalRegister?.primaryEmotion;
  if (primary) out.push(`PRIMARY EMOTION: ${primary}`);
  const be = profile.buyerPsychology?.buyingEmotions;
  if (be) {
    const scored = (["fear", "guilt", "pride", "shame", "trust", "excitement"] as const)
      .map((k) => [k, be[k]] as const)
      .filter(([, n]) => typeof n === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number));
    if (scored.length) out.push("BUYING EMOTIONS (0-10): " + scored.map(([k, n]) => `${k} ${clampScore(n as number)}`).join(", "));
  }
  const hes = profile.buyerPsychology?.purchaseHesitation;
  if (hes) out.push(`TOP HESITATION: ${hes}`);
  const cs = profile.buyerPsychology?.counterStrategy;
  if (cs) out.push(`COUNTER-STRATEGY (follow this order): ${cs}`);
  if (profile.big4?.strongest) out.push(`STRONGEST OF BIG 4: ${profile.big4.strongest}`);
  // Rank desires by scope × urgency × stayingPower.
  const desires = (profile.deepDesires ?? [])
    .map((d) => ({ d, score: (d.scope ?? 0) * (d.urgency ?? 0) * (d.stayingPower ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ d }) => `  • ${d.core || d.surface || "(desire)"}${d.massInstinct ? ` → ${d.massInstinct}` : ""}${d.copyAngle ? ` — angle: ${d.copyAngle}` : ""}`);
  if (desires.length) out.push("RANKED DESIRES:\n" + desires.join("\n"));
  // Rank angle candidates by ev + ma + ws.
  const angles = (profile.angleCandidates ?? [])
    .map((a) => ({ a, score: (a.ev ?? 0) + (a.ma ?? 0) + (a.ws ?? 0) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
    .map(({ a }) => `  • ${a.name}${a.ev != null ? ` (Ev${a.ev}/Ma${a.ma ?? "?"}/Ws${a.ws ?? "?"})` : ""}${a.exampleHook ? ` — hook: "${a.exampleHook}"` : ""}${a.emotionalLever ? ` [lever: ${a.emotionalLever}]` : ""}`);
  if (angles.length) out.push("RANKED ANGLE CANDIDATES:\n" + angles.join("\n"));
  if (!out.length) return "";
  return ["", "── BUYER PSYCHOLOGY & STRATEGY ──", ...out].join("\n");
}

/** Concept directions, trust signals, identification — the visual/proof brief. */
export function renderDesignerProfile(profile: AvatarProfile | null | undefined): string {
  if (!profile) return "";
  const out: string[] = [];
  const directions = (profile.angleCandidates ?? [])
    .flatMap((a) => bullets(a.conceptDirections).map((c) => `  • [${a.name}] ${c}`))
    .slice(0, 8);
  if (directions.length) out.push("CONCEPT DIRECTIONS (proven visual treatments):\n" + directions.join("\n"));
  const trust = bullets(profile.trust?.trustSignals);
  if (trust.length) out.push("TRUST SIGNALS (what makes her believe):\n" + trust.map((t) => `  • ${t}`).join("\n"));
  const id = profile.identification;
  if (id && (id.selfImageToPortray || id.whatTheyWantToLookLike || id.whereTheyWantToBe)) {
    out.push("IDENTIFICATION: " + [
      id.selfImageToPortray && `self-image: ${id.selfImageToPortray}`,
      id.whatTheyWantToLookLike && `look: ${id.whatTheyWantToLookLike}`,
      id.whereTheyWantToBe && `setting: ${id.whereTheyWantToBe}`,
    ].filter(Boolean).join(" · "));
  }
  if (!out.length) return "";
  return ["", "── VISUAL & PROOF BRIEF (from the deep dive) ──", ...out].join("\n");
}
