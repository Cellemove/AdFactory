import assert from "node:assert/strict";
import test from "node:test";
import {
  guessTaxonomyCode,
  normalizeScriptTimestampFormat,
  parseScriptTimestampBeats,
} from "./script-beat-parse";

const SCRIPT = [
  "## BODY",
  "0:00 à 0:05 · Hook",
  "Modèle anatomique assis au bord du lit.",
  '"What would happen to a woman told she\'s bone on bone?"',
  "0:05 à 0:11 · Amplification du symptôme",
  "Même chambre. Elle transfère le poids sur la jambe droite.",
  "0:17 à 0:24 · DAY 1",
  "Elle enfile les leggings par-dessus le genou.",
  "1:04 - 1:10 — Garantie",
  "Portez-les trente jours.",
].join("\n");

test("parses timestamp headers into beats with verbatim quotes", () => {
  const beats = parseScriptTimestampBeats(SCRIPT);
  assert.equal(beats.length, 4);
  assert.deepEqual(beats.map((b) => [b.startSec, b.endSec]), [[0, 5], [5, 11], [17, 24], [64, 70]]);
  assert.equal(beats[0]!.label, "Hook");
  assert.equal(beats[1]!.label, "Amplification du symptôme");
  // Every quote must be an exact substring of the script — the gold-set rule.
  for (const beat of beats) assert.ok(SCRIPT.includes(beat.quote), `quote not verbatim: ${beat.quote}`);
  assert.ok(beats[0]!.quote.includes("bone on bone"));
  assert.equal(beats[3]!.quote, "Portez-les trente jours.");
});

test("returns no beats for scripts without timestamp headers", () => {
  assert.deepEqual(parseScriptTimestampBeats("Just a plain script with no timings."), []);
});

test("parses flattened timestamp lines with inline directions and dialogue", () => {
  const flattened = [
    '00:00 – 00:06 HOOK animé (1, 2 ou 3)."She drained her swollen, aching legs while she slept."Text: "NIGHT 1 →".',
    "",
    '00:06 – 00:14 Elle (~50 ans) déballe le CelluMove, sceptique, le retourne dans ses mains."Her first thought: how can a legging drain my legs?"',
    "",
    '00:14 – 00:30 NIGHT 1. Elle dort avec."Night 1? Honestly, she feels scammed."',
  ].join("\n");
  const beats = parseScriptTimestampBeats(flattened);
  assert.equal(beats.length, 3);
  assert.deepEqual(beats.map((beat) => [beat.startSec, beat.endSec]), [[0, 6], [6, 14], [14, 30]]);
  assert.equal(beats[0]?.label, "HOOK animé (1, 2 ou 3)");
  assert.ok(beats.every((beat) => flattened.includes(beat.quote)));
  assert.match(beats[0]?.quote ?? "", /She drained her swollen/);
});

test("parses timestamps in parentheses after Milanote beat labels", () => {
  const parenthesized = [
    "## HOOK 1",
    "HOOK 1. The Confession (his lines, kept)",
    'VO: "I am actively deceiving the general public right now."',
    "",
    "## BODY",
    "BEAT 1. THE FAST STORY (0:07 - 0:20)",
    'VO: "I lost 62 pounds in seven months."',
    "VISUAL: Still standing there, talking fast.",
    "",
    "BEAT 2. THE REFUSAL (0:20 – 0:27)",
    'VO: "Everybody kept telling me to just get it cut off."',
    "",
    "BEAT 3. CTA (0:27 - 0:35) replaces the old one",
    'VO: "Tap below to try them."',
    "",
    "(0:35 - 0:42)",
    'VO: "The 3D ridges press and release."',
  ].join("\n");

  const beats = parseScriptTimestampBeats(parenthesized);
  assert.equal(beats.length, 4);
  assert.deepEqual(beats.map((beat) => [beat.startSec, beat.endSec]), [[7, 20], [20, 27], [27, 35], [35, 42]]);
  assert.equal(beats[0]?.label, "BEAT 1. THE FAST STORY");
  assert.equal(beats[1]?.label, "BEAT 2. THE REFUSAL");
  assert.equal(beats[2]?.label, "BEAT 3. CTA");
  assert.equal(beats[3]?.label, "");
  assert.match(beats[0]?.quote ?? "", /I lost 62 pounds/);
  assert.match(beats[2]?.quote ?? "", /Tap below/);
  assert.match(beats[3]?.quote ?? "", /3D ridges/);
  assert.ok(beats.every((beat) => parenthesized.includes(beat.quote)));
});

test("normalizes recognized timestamp headings without rewriting script copy", () => {
  const source = [
    "## BODY",
    "BEAT 1. THE FAST STORY (0:07 - 0:20)",
    'VO: "I lost 62 pounds in seven months."',
    "BEAT 2. CTA (0:20 – 0:27) replaces the old one",
    'VO: "Tap below."',
    "(0:27 – 0:35)",
    'VO: "The copy remains unchanged."',
  ].join("\n");

  const normalized = normalizeScriptTimestampFormat(source);
  assert.equal(normalized.detectedHeaderCount, 3);
  assert.equal(normalized.changedHeaderCount, 3);
  assert.match(normalized.scriptText, /0:07 – 0:20 · BEAT 1\. THE FAST STORY/);
  assert.match(normalized.scriptText, /0:20 – 0:27 · BEAT 2\. CTA — replaces the old one/);
  assert.match(normalized.scriptText, /0:27 – 0:35\n/);
  assert.ok(normalized.scriptText.includes('VO: "I lost 62 pounds in seven months."'));
  assert.ok(normalized.scriptText.includes('VO: "Tap below."'));
  assert.ok(normalized.scriptText.includes('VO: "The copy remains unchanged."'));

  const repeated = normalizeScriptTimestampFormat(normalized.scriptText);
  assert.equal(repeated.changedHeaderCount, 0);
  assert.equal(repeated.scriptText, normalized.scriptText);
});

test("guesses taxonomy codes from French and English labels", () => {
  const codes = new Set(["H_OPENING", "P_AGITATION", "PR_TIME_LADDER", "O_GUARANTEE", "B_REATTRIBUTION", "Q_QUESTION"]);
  assert.equal(guessTaxonomyCode("Hook", 0, codes).code, "H_OPENING");
  assert.equal(guessTaxonomyCode("Amplification du symptôme", 1, codes).code, "P_AGITATION");
  assert.equal(guessTaxonomyCode("DAY 1", 2, codes).code, "PR_TIME_LADDER");
  assert.equal(guessTaxonomyCode("WEEK 1, le palier", 3, codes).code, "PR_TIME_LADDER");
  assert.equal(guessTaxonomyCode("Garantie", 4, codes).code, "O_GUARANTEE");
  assert.equal(guessTaxonomyCode("Réattribution", 5, codes).code, "B_REATTRIBUTION");
  const other = guessTaxonomyCode("Mystery section", 5, codes);
  assert.equal(other.code, "OTHER");
  assert.equal(other.otherExplanation, "Unmapped section: Mystery section");
  // First beat with no keyword falls back to the opening hook, not OTHER.
  assert.equal(guessTaxonomyCode("", 0, codes).code, "H_OPENING");
});

test("degrades specific guesses to the layer's generic code under a coarse taxonomy", () => {
  // copy-taxonomy-v1's actual code set — only generic per-layer codes.
  const v1 = new Set(["H_OPENING", "Q_QUESTION", "P_PROBLEM", "B_BENEFIT", "M_MECHANISM", "PR_PROOF", "O_OFFER", "O_CTA", "OTHER"]);
  assert.equal(guessTaxonomyCode("Amplification du symptôme", 1, v1).code, "P_PROBLEM");
  assert.equal(guessTaxonomyCode("DAY 1", 2, v1).code, "PR_PROOF");
  assert.equal(guessTaxonomyCode("WEEK 1, le palier", 3, v1).code, "PR_PROOF");
  assert.equal(guessTaxonomyCode("Garantie", 4, v1).code, "O_OFFER");
  assert.equal(guessTaxonomyCode("Réattribution", 5, v1).code, "B_BENEFIT");
  assert.equal(guessTaxonomyCode("Négation et tease", 6, v1).code, "PR_PROOF");
  assert.equal(guessTaxonomyCode("Objection", 6, v1).code, "PR_PROOF");
  assert.equal(guessTaxonomyCode("Failed alternatives", 6, v1).code, "PR_PROOF");
  assert.equal(guessTaxonomyCode("Mécanisme quantifié", 7, v1).code, "M_MECHANISM");
});

test("uses beat copy context before assigning an ambiguous taxonomy code", () => {
  const v1 = new Set(["H_OPENING", "Q_QUESTION", "P_PROBLEM", "B_BENEFIT", "M_MECHANISM", "PR_PROOF", "O_OFFER", "O_CTA", "OTHER"]);
  assert.equal(
    guessTaxonomyCode("BEAT 4. THE EXPLANATION", 3, v1, {
      quote: "The 3D ridges press and release to support blood flow.",
      startSec: 35,
    }).code,
    "M_MECHANISM",
  );
  assert.equal(
    guessTaxonomyCode("BEAT 1. THE FAST STORY", 0, v1, {
      quote: "I lost 62 pounds in seven months.",
      startSec: 7,
    }).code,
    "PR_PROOF",
  );
  assert.equal(
    guessTaxonomyCode("BEAT 2. TRANSITION", 0, v1, {
      quote: "She walks into the next room.",
      startSec: 7,
    }).code,
    "OTHER",
  );
});
