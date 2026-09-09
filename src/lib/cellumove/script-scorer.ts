import { createHash } from "node:crypto";
import { z } from "zod";
import type { ScriptDocument, ScriptModule } from "@/lib/cellumove/script-studio";

export const SCORER_ENGINE_VERSION = "script-scorer-v1";
export const SCORER_TAXONOMY_VERSION = "copy-taxonomy-v1";
export const SCORER_EXTRACTOR_PROMPT_VERSION = "script-scorer-extractor-v1";
export const SCORER_BASELINE_VERSION = "gold-35-v1";
export const GROUNDING_THRESHOLD = 0.72;

export const ScorerLayerSchema = z.enum(["H", "Q", "P", "B", "M", "PR", "O", "OTHER"]);
export type ScorerLayer = z.infer<typeof ScorerLayerSchema>;

export const ScorerModuleKeySchema = z.enum([
  "structural_fit",
  "verbatim_grounding",
  "specificity",
  "fact_verification",
  "observer_flags",
]);
export type ScorerModuleKey = z.infer<typeof ScorerModuleKeySchema>;

export const ScorerModuleStatusSchema = z.enum([
  "scored",
  "not_configured",
  "insufficient_evidence",
  "failed",
]);
export type ScorerModuleStatus = z.infer<typeof ScorerModuleStatusSchema>;

export const AnalyzedScriptLineSchema = z.object({
  scriptModuleId: z.string().min(1),
  lineIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
  layer: ScorerLayerSchema,
  code: z.string().min(1),
  otherExplanation: z.string().trim().min(1).nullable().optional(),
  concreteSpans: z.array(z.object({
    text: z.string().min(1),
    kind: z.enum(["number", "time", "place", "named_object", "action", "sensory"]),
  })),
  factualAssertions: z.array(z.object({
    quote: z.string().min(1),
    normalizedClaim: z.string().min(1),
    claimType: z.enum(["product", "mechanism", "outcome", "price", "guarantee", "bonus", "availability"]),
  })),
}).strict();

export const AnalyzedScriptSchema = z.object({
  lines: z.array(AnalyzedScriptLineSchema),
}).strict();

export type AnalyzedScriptLine = z.infer<typeof AnalyzedScriptLineSchema>;
export type AnalyzedScript = z.infer<typeof AnalyzedScriptSchema>;

export type ScriptScorerFinding = {
  module: ScorerModuleKey;
  severity: "info" | "warning" | "critical";
  scriptModuleId: string | null;
  lineIndex: number | null;
  scriptQuote: string | null;
  message: string;
  recommendation: string | null;
  evidenceType: string | null;
  evidenceId: string | null;
  evidenceQuote: string | null;
  similarity: number | null;
  metadata?: Record<string, unknown>;
};

export type ScriptScorerModuleResult = {
  module: ScorerModuleKey;
  status: ScorerModuleStatus;
  score: number | null;
  label: string;
  summary: string;
  metrics: Record<string, unknown>;
  findings: ScriptScorerFinding[];
};

export type ScriptSourceLine = {
  scriptModuleId: string;
  lineIndex: number;
  text: string;
  moduleKind: ScriptModule["kind"];
  moduleLabel: string;
};

export type GoldBeatInput = {
  code: string;
  layer: ScorerLayer;
  orderIndex: number;
  startSec: number | null;
  endSec: number | null;
};

export type GoldAdInput = {
  id: string;
  angleSlug: string;
  format: string;
  beats: GoldBeatInput[];
};

export type GroundingMatch = {
  line: AnalyzedScriptLine;
  evidenceId: string | null;
  evidenceQuote: string | null;
  similarity: number | null;
};

export type ApprovedEvidence = {
  id: string;
  type: "brand_fact" | "product_offer";
  text: string;
};

export function scriptSourceLines(document: ScriptDocument): ScriptSourceLine[] {
  const lines: ScriptSourceLine[] = [];
  for (const scriptModule of document.modules) {
    const chunks = scriptModule.spokenText
      .split(/\n+/)
      .flatMap((paragraph) => paragraph.match(/[^.!?]+[.!?]?/g) ?? [])
      .map((value) => value.trim())
      .filter(Boolean);
    chunks.forEach((text, lineIndex) => lines.push({
      scriptModuleId: scriptModule.id,
      lineIndex,
      text,
      moduleKind: scriptModule.kind,
      moduleLabel: scriptModule.label,
    }));
  }
  return lines;
}

export function defaultLayerForKind(kind: ScriptModule["kind"]): ScorerLayer {
  if (kind === "hook") return "H";
  if (kind === "problem" || kind === "agitation") return "P";
  if (kind === "solution") return "M";
  if (kind === "proof") return "PR";
  if (kind === "offer" || kind === "cta") return "O";
  return "OTHER";
}

export function validateAnalyzedScript(input: {
  document: ScriptDocument;
  analysis: unknown;
  allowedCodes: ReadonlyMap<string, ScorerLayer>;
}): AnalyzedScript {
  const parsed = AnalyzedScriptSchema.parse(input.analysis);
  const source = scriptSourceLines(input.document);
  if (parsed.lines.length !== source.length) {
    throw new Error(`Extractor returned ${parsed.lines.length} lines; expected ${source.length}.`);
  }
  const sourceByKey = new Map(source.map((line) => [`${line.scriptModuleId}:${line.lineIndex}`, line]));
  const seen = new Set<string>();
  for (const line of parsed.lines) {
    const key = `${line.scriptModuleId}:${line.lineIndex}`;
    const expected = sourceByKey.get(key);
    if (!expected) throw new Error(`Extractor returned an unknown line ${key}.`);
    if (seen.has(key)) throw new Error(`Extractor returned duplicate line ${key}.`);
    seen.add(key);
    if (line.text !== expected.text) throw new Error(`Extractor changed the source text for ${key}.`);
    const expectedLayer = input.allowedCodes.get(line.code);
    if (!expectedLayer) throw new Error(`Extractor returned unknown taxonomy code ${line.code}.`);
    if (line.layer !== expectedLayer) throw new Error(`Extractor paired ${line.code} with ${line.layer}; expected ${expectedLayer}.`);
    if (line.layer === "OTHER" && !line.otherExplanation?.trim()) {
      throw new Error(`Extractor must explain OTHER classification for ${key}.`);
    }
    for (const span of line.concreteSpans) {
      if (!line.text.includes(span.text)) throw new Error(`Concrete span is not an exact quote for ${key}.`);
    }
    for (const assertion of line.factualAssertions) {
      if (!line.text.includes(assertion.quote)) throw new Error(`Factual assertion is not an exact quote for ${key}.`);
    }
  }
  return parsed;
}

export function scorerInputHash(input: {
  document: ScriptDocument;
  marketCode: string;
  productId: string;
  angleId: string;
  subAvatarId: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function lcsLength(a: string[], b: string[]): number {
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? (previous[j - 1] ?? 0) + 1
        : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return previous[b.length] ?? 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function firstAnchor(lines: AnalyzedScriptLine[]): Pick<ScriptScorerFinding, "scriptModuleId" | "lineIndex" | "scriptQuote"> {
  const first = lines[0];
  return {
    scriptModuleId: first?.scriptModuleId ?? null,
    lineIndex: first?.lineIndex ?? null,
    scriptQuote: first?.text ?? null,
  };
}

export function scoreStructuralFit(input: {
  document: ScriptDocument;
  analysis: AnalyzedScript;
  goldAds: GoldAdInput[];
  angleSlug: string;
  format: string;
}): ScriptScorerModuleResult {
  const exact = input.goldAds.filter((ad) => ad.angleSlug === input.angleSlug && ad.format.toLowerCase() === input.format.toLowerCase());
  const angleOnly = input.goldAds.filter((ad) => ad.angleSlug === input.angleSlug);
  const cohort = exact.length >= 5 ? exact : angleOnly.length >= 5 ? angleOnly : [];
  const cohortType = exact.length >= 5 ? "angle_and_format" : angleOnly.length >= 5 ? "angle" : null;
  if (!cohort.length) {
    return {
      module: "structural_fit",
      status: "insufficient_evidence",
      score: null,
      label: "Gold-set structural fit — provisional",
      summary: "At least five matching gold ads are required before structural fit can be scored.",
      metrics: { exactMatches: exact.length, angleMatches: angleOnly.length, minimumRequired: 5 },
      findings: [],
    };
  }

  const codeStats = new Map<string, { ads: number; positions: number[]; durations: number[] }>();
  for (const ad of cohort) {
    const ordered = [...ad.beats].sort((a, b) => a.orderIndex - b.orderIndex);
    const seen = new Set<string>();
    ordered.forEach((beat, index) => {
      const stats = codeStats.get(beat.code) ?? { ads: 0, positions: [], durations: [] };
      if (!seen.has(beat.code)) {
        stats.ads += 1;
        seen.add(beat.code);
      }
      stats.positions.push(index);
      if (beat.startSec != null && beat.endSec != null && beat.endSec > beat.startSec) {
        stats.durations.push(beat.endSec - beat.startSec);
      }
      codeStats.set(beat.code, stats);
    });
  }
  const expectedCodes = [...codeStats.entries()]
    .filter(([, stats]) => stats.ads / cohort.length >= 0.5)
    .sort((a, b) => (median(a[1].positions) ?? 0) - (median(b[1].positions) ?? 0))
    .map(([code]) => code);
  if (!expectedCodes.length) {
    return {
      module: "structural_fit",
      status: "insufficient_evidence",
      score: null,
      label: "Gold-set structural fit — provisional",
      summary: "The matching gold cohort has no beat shared by at least half of its ads.",
      metrics: { cohortSize: cohort.length, cohortType },
      findings: [],
    };
  }

  const sequence = input.analysis.lines.map((line) => line.code).filter((code, index, all) => index === 0 || code !== all[index - 1]);
  const present = new Set(sequence);
  const coverage = expectedCodes.filter((code) => present.has(code)).length / expectedCodes.length;
  const filtered = sequence.filter((code) => expectedCodes.includes(code));
  const order = lcsLength(filtered, expectedCodes) / expectedCodes.length;

  const moduleById = new Map(input.document.modules.map((module) => [module.id, module]));
  const lineCountByModule = new Map<string, number>();
  input.analysis.lines.forEach((line) => lineCountByModule.set(line.scriptModuleId, (lineCountByModule.get(line.scriptModuleId) ?? 0) + 1));
  const actualDurations = new Map<string, number>();
  input.analysis.lines.forEach((line) => {
    const scriptModule = moduleById.get(line.scriptModuleId);
    if (!scriptModule) return;
    const share = scriptModule.durationSec / Math.max(1, lineCountByModule.get(line.scriptModuleId) ?? 1);
    actualDurations.set(line.code, (actualDurations.get(line.code) ?? 0) + share);
  });
  const durationSimilarities = expectedCodes.flatMap((code) => {
    const expected = median(codeStats.get(code)?.durations ?? []);
    const actual = actualDurations.get(code);
    if (expected == null || actual == null || expected <= 0) return [];
    return [1 - Math.min(1, Math.abs(actual - expected) / expected)];
  });
  const duration = durationSimilarities.length
    ? durationSimilarities.reduce((sum, value) => sum + value, 0) / durationSimilarities.length
    : null;
  const weighted = duration == null
    ? ((coverage * 45) + (order * 35)) / 0.8
    : (coverage * 45) + (order * 35) + (duration * 20);
  const findings: ScriptScorerFinding[] = [];
  for (const code of expectedCodes.filter((expected) => !present.has(expected))) {
    findings.push({
      module: "structural_fit",
      severity: "warning",
      ...firstAnchor(input.analysis.lines),
      message: `The gold cohort usually contains ${code}, but this script does not.`,
      recommendation: "Review whether the missing beat serves the angle before adding it; creative variation is allowed.",
      evidenceType: "gold_cohort",
      evidenceId: null,
      evidenceQuote: null,
      similarity: null,
      metadata: { code },
    });
  }
  if (order < 0.8) {
    findings.push({
      module: "structural_fit",
      severity: "warning",
      ...firstAnchor(input.analysis.lines),
      message: "The relative beat order differs substantially from the matching gold cohort.",
      recommendation: "Compare the opening-to-offer progression with the cohort; keep the variation if it is deliberate.",
      evidenceType: "gold_cohort",
      evidenceId: null,
      evidenceQuote: expectedCodes.join(" → "),
      similarity: order,
    });
  }
  return {
    module: "structural_fit",
    status: "scored",
    score: boundedScore(weighted),
    label: "Gold-set structural fit — provisional",
    summary: `Compared with ${cohort.length} gold ads matched by ${cohortType === "angle_and_format" ? "angle and format" : "angle"}.`,
    metrics: {
      cohortSize: cohort.length,
      cohortType,
      goldAdIds: cohort.map((ad) => ad.id),
      expectedCodes,
      actualCodes: sequence,
      coverage: boundedScore(coverage * 100),
      orderSimilarity: boundedScore(order * 100),
      durationSimilarity: duration == null ? null : boundedScore(duration * 100),
      durationWeightRebalanced: duration == null,
    },
    findings,
  };
}

export function scoreVerbatimGrounding(input: {
  matches: GroundingMatch[];
  candidateCount: number;
  cohort: string | null;
  threshold?: number;
}): ScriptScorerModuleResult {
  const threshold = input.threshold ?? GROUNDING_THRESHOLD;
  if (input.candidateCount < 10) {
    return {
      module: "verbatim_grounding",
      status: "insufficient_evidence",
      score: null,
      label: "Verified-verbatim grounding — experimental",
      summary: "At least ten verified, embedded verbatims are required for the selected audience cohort.",
      metrics: { candidateCount: input.candidateCount, minimumRequired: 10, cohort: input.cohort, threshold },
      findings: [],
    };
  }
  const eligible = input.matches.filter((match) => ["H", "Q", "P", "B"].includes(match.line.layer));
  if (!eligible.length) {
    return {
      module: "verbatim_grounding",
      status: "scored",
      score: 100,
      label: "Verified-verbatim grounding — experimental",
      summary: "No audience-language lines were detected.",
      metrics: { candidateCount: input.candidateCount, eligibleLines: 0, groundedLines: 0, cohort: input.cohort, threshold },
      findings: [],
    };
  }
  const grounded = eligible.filter((match) => (match.similarity ?? -1) >= threshold);
  const findings = eligible.filter((match) => (match.similarity ?? -1) < threshold).map((match): ScriptScorerFinding => ({
    module: "verbatim_grounding",
    severity: "warning",
    scriptModuleId: match.line.scriptModuleId,
    lineIndex: match.line.lineIndex,
    scriptQuote: match.line.text,
    message: "This audience-facing line is not closely grounded in the verified verbatim cohort.",
    recommendation: "Review verified customer language for a more recognizable expression of the same idea.",
    evidenceType: match.evidenceId ? "verbatim" : null,
    evidenceId: match.evidenceId,
    evidenceQuote: match.evidenceQuote,
    similarity: match.similarity,
  }));
  for (const match of grounded) {
    findings.push({
      module: "verbatim_grounding",
      severity: "info",
      scriptModuleId: match.line.scriptModuleId,
      lineIndex: match.line.lineIndex,
      scriptQuote: match.line.text,
      message: "This audience-facing line is grounded in the verified verbatim cohort.",
      recommendation: null,
      evidenceType: match.evidenceId ? "verbatim" : null,
      evidenceId: match.evidenceId,
      evidenceQuote: match.evidenceQuote,
      similarity: match.similarity,
    });
  }
  return {
    module: "verbatim_grounding",
    status: "scored",
    score: boundedScore((grounded.length / eligible.length) * 100),
    label: "Verified-verbatim grounding — experimental",
    summary: `${grounded.length} of ${eligible.length} audience-language lines cleared the provisional similarity threshold.`,
    metrics: { candidateCount: input.candidateCount, eligibleLines: eligible.length, groundedLines: grounded.length, cohort: input.cohort, threshold },
    findings,
  };
}

export function scoreSpecificity(analysis: AnalyzedScript): ScriptScorerModuleResult {
  const meaningful = analysis.lines.filter((line) => line.text.replace(/\W/g, "").length >= 3);
  const concreteCount = meaningful.reduce((sum, line) => sum + line.concreteSpans.length, 0);
  const generic = meaningful.filter((line) => line.concreteSpans.length === 0);
  const ratio = concreteCount / Math.max(generic.length, 1);
  return {
    module: "specificity",
    status: "scored",
    score: boundedScore(Math.min(100, (ratio / 3) * 100)),
    label: "Specificity",
    summary: `${concreteCount} concrete details across ${meaningful.length} meaningful lines; ${generic.length} lines remain generic.`,
    metrics: { meaningfulLines: meaningful.length, concreteSpanCount: concreteCount, genericLineCount: generic.length, ratio },
    findings: generic.map((line): ScriptScorerFinding => ({
      module: "specificity",
      severity: "warning",
      scriptModuleId: line.scriptModuleId,
      lineIndex: line.lineIndex,
      scriptQuote: line.text,
      message: "This line contains no detected quantity, time, place, named object, observable action, or sensory detail.",
      recommendation: "Add one supportable, observable detail if specificity would strengthen this line.",
      evidenceType: null,
      evidenceId: null,
      evidenceQuote: null,
      similarity: null,
    })),
  };
}

function normalizedTokens(value: string): Set<string> {
  const stop = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with", "you", "your"]);
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !stop.has(token)) ?? []);
}

function tokenOverlap(a: string, b: string): number {
  const left = normalizedTokens(a);
  const right = normalizedTokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.min(left.size, right.size);
}

function numbers(value: string): string[] {
  return value.match(/\d+(?:[.,]\d+)?/g)?.map((item) => item.replace(",", ".")) ?? [];
}

export function scoreFactVerification(input: {
  analysis: AnalyzedScript;
  evidence: ApprovedEvidence[];
}): ScriptScorerModuleResult {
  const assertions = input.analysis.lines.flatMap((line) => line.factualAssertions.map((assertion) => ({ line, assertion })));
  if (!input.evidence.length) {
    return {
      module: "fact_verification",
      status: "not_configured",
      score: null,
      label: "Fact and offer verification",
      summary: "No approved product facts or offers are configured for this product and market.",
      metrics: { assertionCount: assertions.length, evidenceCount: 0 },
      findings: [],
    };
  }
  if (!assertions.length) {
    return {
      module: "fact_verification",
      status: "scored",
      score: 100,
      label: "Fact and offer verification",
      summary: "No checkable factual or offer assertions were detected.",
      metrics: { assertionCount: 0, evidenceCount: input.evidence.length, supportedCount: 0 },
      findings: [],
    };
  }
  let supportedCount = 0;
  const findings: ScriptScorerFinding[] = [];
  for (const { line, assertion } of assertions) {
    const ranked = input.evidence
      .map((evidence) => ({ evidence, overlap: tokenOverlap(assertion.normalizedClaim, evidence.text) }))
      .sort((a, b) => b.overlap - a.overlap);
    const best = ranked[0];
    const claimNumbers = numbers(assertion.normalizedClaim);
    const evidenceNumbers = numbers(best?.evidence.text ?? "");
    const comparable = (best?.overlap ?? 0) >= 0.35;
    const numericConflict = comparable && claimNumbers.length > 0 && evidenceNumbers.length > 0
      && claimNumbers.some((number) => !evidenceNumbers.includes(number));
    const supported = comparable && !numericConflict && (best?.overlap ?? 0) >= 0.55;
    if (supported) {
      supportedCount += 1;
      findings.push({
        module: "fact_verification",
        severity: "info",
        scriptModuleId: line.scriptModuleId,
        lineIndex: line.lineIndex,
        scriptQuote: assertion.quote,
        message: "This assertion is supported by an approved record.",
        recommendation: null,
        evidenceType: best?.evidence.type ?? null,
        evidenceId: best?.evidence.id ?? null,
        evidenceQuote: best?.evidence.text ?? null,
        similarity: best?.overlap ?? null,
      });
      continue;
    }
    findings.push({
      module: "fact_verification",
      severity: numericConflict ? "critical" : "warning",
      scriptModuleId: line.scriptModuleId,
      lineIndex: line.lineIndex,
      scriptQuote: assertion.quote,
      message: numericConflict
        ? "This assertion conflicts with a numeric value in the closest approved record."
        : "No approved fact or offer sufficiently supports this assertion.",
      recommendation: numericConflict
        ? "Correct the value to match the approved record before production."
        : "Add an approved source or soften/remove the assertion.",
      evidenceType: best?.evidence.type ?? null,
      evidenceId: best?.evidence.id ?? null,
      evidenceQuote: best?.evidence.text ?? null,
      similarity: best?.overlap ?? null,
    });
  }
  return {
    module: "fact_verification",
    status: "scored",
    score: boundedScore((supportedCount / assertions.length) * 100),
    label: "Fact and offer verification",
    summary: `${supportedCount} of ${assertions.length} checkable assertions are supported by approved records.`,
    metrics: { assertionCount: assertions.length, evidenceCount: input.evidence.length, supportedCount },
    findings,
  };
}

export function scoreObserverFlags(input: { document: ScriptDocument; analysis: AnalyzedScript }): ScriptScorerModuleResult {
  const findings: ScriptScorerFinding[] = [];
  const seen = new Map<string, AnalyzedScriptLine>();
  const addRegexFlag = (line: AnalyzedScriptLine, regex: RegExp, severity: "info" | "warning" | "critical", message: string) => {
    if (!regex.test(line.text)) return;
    findings.push({
      module: "observer_flags", severity, scriptModuleId: line.scriptModuleId, lineIndex: line.lineIndex,
      scriptQuote: line.text, message, recommendation: "Review this wording before production.",
      evidenceType: null, evidenceId: null, evidenceQuote: null, similarity: null,
    });
  };
  for (const line of input.analysis.lines) {
    addRegexFlag(line, /\[(?:citation|source|proof)\]|\b(?:citation|source) needed\b/i, "critical", "This line contains an unresolved evidence placeholder.");
    addRegexFlag(line, /\b(best|greatest|number one|#1|only|guaranteed|always|never)\b/i, "warning", "This line contains an absolute or superlative claim.");
    addRegexFlag(line, /\b(cure|treat|diagnos|disease|clinical(?:ly)? proven|doctor approved|heal|prevent)\w*/i, "warning", "This line may contain medical or regulated language.");
    const key = line.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const duplicate = seen.get(key);
    if (key.length >= 12 && duplicate) {
      findings.push({
        module: "observer_flags", severity: "info", scriptModuleId: line.scriptModuleId, lineIndex: line.lineIndex,
        scriptQuote: line.text, message: "This line duplicates another line in the script.", recommendation: "Confirm the repetition is deliberate.",
        evidenceType: "script_line", evidenceId: `${duplicate.scriptModuleId}:${duplicate.lineIndex}`, evidenceQuote: duplicate.text, similarity: 1,
      });
    } else if (key) seen.set(key, line);
  }
  if (!input.document.modules.some((module) => module.kind === "cta" || module.kind === "offer")) {
    findings.push({
      module: "observer_flags", severity: "warning", ...firstAnchor(input.analysis.lines),
      message: "The script has no CTA or offer module.", recommendation: "Confirm the intended next step is explicit.",
      evidenceType: null, evidenceId: null, evidenceQuote: null, similarity: null,
    });
  }
  const actualDuration = input.document.modules.reduce((sum, module) => sum + module.durationSec, 0);
  if (Math.abs(actualDuration - input.document.targetDurationSec) > 1) {
    findings.push({
      module: "observer_flags", severity: "warning", ...firstAnchor(input.analysis.lines),
      message: `Module timing totals ${actualDuration}s, not the ${input.document.targetDurationSec}s target.`,
      recommendation: "Rebalance module durations before handoff.", evidenceType: null, evidenceId: null, evidenceQuote: null, similarity: null,
    });
  }
  return {
    module: "observer_flags",
    status: "scored",
    score: null,
    label: "Observer-only flags",
    summary: findings.length ? `${findings.length} non-blocking review flag${findings.length === 1 ? "" : "s"}.` : "No observer flags detected.",
    metrics: { flagCount: findings.length },
    findings,
  };
}
