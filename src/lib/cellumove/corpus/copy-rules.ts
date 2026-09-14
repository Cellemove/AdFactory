// COPY RULES — the copywriting layer of a brand playbook. Pure statistics over
// a brand's transcripts and beats: how they write (tone stats) and what they
// keep doing (rules), each rule carrying the share of ads that follow it and
// real quotes as proof. No model anywhere in this file: a rule that cannot be
// counted is not a rule.

import type { TranscriptChannel } from "./constants";
import { tokens } from "./evidence-gate";

export type CopyLine = {
  adId: string;
  channel: TranscriptChannel;
  tStart: number;
  text: string;
};

export type CopyBeat = {
  adId: string;
  orderIndex: number;
  layer: string;
  code: string;
  startSec: number | null;
  evidenceQuote: string;
};

export type CopyAd = {
  id: string;
  /** Best-ranked ads are quoted first. */
  winnerScore: number | null;
  lines: CopyLine[];
  beats: CopyBeat[];
};

export type CopyExample = { adId: string; tStart: number | null; text: string };

export type CopyRule = {
  key: string;
  rule: string;
  /** What to keep when writing in this voice. */
  how: string;
  ads: number;
  share: number;
  examples: CopyExample[];
};

export type ToneStat = { key: string; label: string; value: string; note?: string };

export type CopyProfile = {
  adCount: number;
  tone: ToneStat[];
  rules: CopyRule[];
  /** Words and short phrases this brand keeps coming back to. */
  signatureWords: Array<{ term: string; ads: number; share: number }>;
};

const SECOND_PERSON = /\b(you|your|you're|yours|yourself)\b/i;
const FIRST_PERSON = /\b(i|i'm|i've|my|me|mine)\b/i;
const FIRST_PLURAL = /\b(we|we're|we've|our|us)\b/i;
const HAS_NUMBER = /\d/;
const HARD_CTA = /\b(buy now|order now|shop now|get yours|add to cart|claim yours|grab yours|order today|buy today)\b/i;
const SOFT_CTA = /\b(see why|find out|learn (more|how|why)|discover|try (it|them)|check (it|them) out|tap (below|the link)|link (below|in bio))\b/i;
const PROFANITY = /\b(fuck\w*|shit\w*|damn|bullshit|crap|hell)\b/i;
const TIME_WORD = /\b(week|day|month|night|morning|am|pm|o'clock|\d+\s?(days?|weeks?|months?|years?|lbs?|kg|pounds?|kilos?))\b/i;
const STOPWORDS = new Set(("a an the and or but so if of to in on at for with from by as is are was were be been it its this that these those i me my we our you your he she they them his her their not no do does did have has had will would can could just very really more most than then there here what which who when how all any some one get got like").split(" "));

const pct = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0);

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function wordCount(text: string): number {
  return tokens(text).length;
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function firstLine(ad: CopyAd): CopyLine | null {
  return [...ad.lines].sort((a, b) => a.tStart - b.tStart)[0] ?? null;
}

function byRank(ads: CopyAd[]): CopyAd[] {
  return [...ads].sort((a, b) => (b.winnerScore ?? -1) - (a.winnerScore ?? -1));
}

function example(ad: CopyAd, text: string, tStart: number | null): CopyExample {
  return { adId: ad.id, tStart, text: text.length > 160 ? `${text.slice(0, 157)}…` : text };
}

// ─── Tone ────────────────────────────────────────────────────────────────────

export function toneStats(ads: CopyAd[]): ToneStat[] {
  const vo = ads.flatMap((ad) => ad.lines.filter((line) => line.channel === "vo"));
  const ost = ads.flatMap((ad) => ad.lines.filter((line) => line.channel === "ost"));
  const allSentences = vo.flatMap((line) => sentences(line.text));
  const avgSentence = allSentences.length ? allSentences.reduce((sum, sentence) => sum + wordCount(sentence), 0) / allSentences.length : 0;
  const perAd = (test: (line: CopyLine) => boolean, lines: CopyLine[]) => ads.filter((ad) => lines.some((line) => line.adId === ad.id && test(line))).length;
  const you = perAd((line) => SECOND_PERSON.test(line.text), vo);
  const me = perAd((line) => FIRST_PERSON.test(line.text), vo);
  const questions = ads.filter((ad) => { const first = firstLine(ad); return Boolean(first && /\?/.test(first.text)); }).length;
  const caps = ost.filter((line) => isAllCaps(line.text)).length;
  const avgCaption = ost.length ? ost.reduce((sum, line) => sum + wordCount(line.text), 0) / ost.length : 0;
  const ostOnly = ads.filter((ad) => ad.lines.some((line) => line.channel === "ost") && !ad.lines.some((line) => line.channel === "vo")).length;
  const stats: ToneStat[] = [
    { key: "sentence", label: "Average sentence", value: `${avgSentence.toFixed(0)} words`, note: avgSentence <= 9 ? "short, spoken rhythm" : avgSentence <= 14 ? "conversational" : "long, explanatory" },
    { key: "person", label: "Speaks as", value: you >= me ? `"you" (${Math.round(pct(you, ads.length) * 100)}% of ads)` : `"I" (${Math.round(pct(me, ads.length) * 100)}% of ads)` },
    { key: "question", label: "Opens with a question", value: `${Math.round(pct(questions, ads.length) * 100)}% of ads` },
    { key: "caption", label: "On-screen captions", value: `${avgCaption.toFixed(0)} words each`, note: ost.length ? `${Math.round(pct(caps, ost.length) * 100)}% in ALL CAPS` : "none" },
  ];
  if (ostOnly > 0) stats.push({ key: "silent", label: "Text-only ads", value: `${ostOnly} of ${ads.length}`, note: "no voiceover at all" });
  return stats;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

type Detector = {
  key: string;
  rule: string;
  how: string;
  /** Returns the proof line when the ad follows the rule, else null. */
  find: (ad: CopyAd) => CopyExample | null;
};

function beat(ad: CopyAd, predicate: (beat: CopyBeat) => boolean): CopyBeat | null {
  return [...ad.beats].sort((a, b) => a.orderIndex - b.orderIndex).find(predicate) ?? null;
}

function line(ad: CopyAd, predicate: (line: CopyLine) => boolean): CopyLine | null {
  return [...ad.lines].sort((a, b) => a.tStart - b.tStart).find(predicate) ?? null;
}

const DETECTORS: Detector[] = [
  {
    key: "opens-on-pain",
    rule: "Opens on the problem, not the product",
    how: "The first beat is the viewer's pain or a pointed question about it; the product waits.",
    find: (ad) => {
      const first = [...ad.beats].sort((a, b) => a.orderIndex - b.orderIndex)[0];
      return first && (first.layer === "P" || first.code === "H_PAIN" || first.code === "H_QUESTION") ? example(ad, first.evidenceQuote, first.startSec) : null;
    },
  },
  {
    key: "dated-pain",
    rule: "Pins the pain to a specific moment or number",
    how: "A time of day, a week, a weight, a place — never 'if you struggle with…'.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "P_HYPER_DATED" || (item.layer === "P" && TIME_WORD.test(item.evidenceQuote) && HAS_NUMBER.test(item.evidenceQuote)));
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "second-person",
    rule: "Talks to the viewer as \"you\"",
    how: "Second person in the voiceover; the brand stays out of the sentence.",
    find: (ad) => {
      const hit = line(ad, (item) => item.channel === "vo" && SECOND_PERSON.test(item.text));
      return hit ? example(ad, hit.text, hit.tStart) : null;
    },
  },
  {
    key: "first-person",
    rule: "Told in the first person as a testimony",
    how: "\"I\" and \"my\": a customer or founder speaking, not a narrator.",
    find: (ad) => {
      const hit = line(ad, (item) => item.channel === "vo" && FIRST_PERSON.test(item.text));
      return hit ? example(ad, hit.text, hit.tStart) : null;
    },
  },
  {
    key: "failed-alternatives",
    rule: "Names what failed before introducing the product",
    how: "Two or three alternatives dismissed with a reason each, before the mechanism.",
    find: (ad) => {
      const failed = beat(ad, (item) => item.code === "B_FAILED_ALTERNATIVES");
      const mechanism = beat(ad, (item) => item.layer === "M");
      return failed && (!mechanism || failed.orderIndex < mechanism.orderIndex) ? example(ad, failed.evidenceQuote, failed.startSec) : null;
    },
  },
  {
    key: "reattribution",
    rule: "Blames a different cause than the viewer expects",
    how: "\"It's not X, it's Y\" — the belief shift comes before the mechanism.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "B_REATTRIBUTION");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "number-in-proof",
    rule: "Puts a hard number in the proof",
    how: "A customer count, a rating, a day count — one specific figure, stated plainly.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.layer === "PR" && HAS_NUMBER.test(item.evidenceQuote));
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "time-ladder",
    rule: "Shows results as a ladder over time",
    how: "Week 1, week 3, day 30, day 90 — progress in dated steps, not one big reveal.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "PR_TIME_LADDER");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "inoculation",
    rule: "Admits the doubt before the viewer can",
    how: "\"Week one, nothing. That's fair.\" — pre-empt skepticism, then answer it.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "B_SKEPTICISM_INOCULATION");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "guarantee",
    rule: "States the guarantee inside the story",
    how: "Risk reversal in plain words about the person on screen, not legal copy.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "O_GUARANTEE");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "reason-why",
    rule: "Gives a reason for the deal",
    how: "The offer explains itself — why it's free, why now, why two.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "O_REASON_WHY");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
  {
    key: "soft-cta",
    rule: "Closes with a soft call to action",
    how: "\"See why\", \"find out how\", \"try it\" — curiosity, never \"buy now\".",
    find: (ad) => {
      const hard = line(ad, (item) => HARD_CTA.test(item.text));
      const soft = line(ad, (item) => SOFT_CTA.test(item.text));
      return soft && !hard ? example(ad, soft.text, soft.tStart) : null;
    },
  },
  {
    key: "hard-cta",
    rule: "Closes with a direct command to buy",
    how: "\"Shop now\", \"order today\" — an instruction, not an invitation.",
    find: (ad) => {
      const hit = line(ad, (item) => HARD_CTA.test(item.text));
      return hit ? example(ad, hit.text, hit.tStart) : null;
    },
  },
  {
    key: "captions-echo",
    rule: "Captions repeat the key words of the voiceover",
    how: "On-screen text is the voiceover's keywords, 3–6 words, not new information.",
    find: (ad) => {
      const vo = new Set(ad.lines.filter((item) => item.channel === "vo").flatMap((item) => tokens(item.text)));
      const caption = line(ad, (item) => item.channel === "ost" && wordCount(item.text) >= 2 && tokens(item.text).filter((token) => vo.has(token)).length / wordCount(item.text) >= 0.6);
      return caption ? example(ad, caption.text, caption.tStart) : null;
    },
  },
  {
    key: "caps-captions",
    rule: "Writes captions in ALL CAPS",
    how: "Short, capitalised overlays that read as headlines.",
    find: (ad) => {
      const ost = ad.lines.filter((item) => item.channel === "ost");
      if (!ost.length) return null;
      const caps = ost.filter((item) => isAllCaps(item.text));
      const hit = caps[0];
      return hit && caps.length / ost.length >= 0.6 ? example(ad, hit.text, hit.tStart) : null;
    },
  },
  {
    key: "swears",
    rule: "Swears for emphasis",
    how: "Profanity in the pain and the mechanism — never in the guarantee.",
    find: (ad) => {
      const hit = line(ad, (item) => PROFANITY.test(item.text));
      return hit ? example(ad, hit.text, hit.tStart) : null;
    },
  },
  {
    key: "clean-guarantee",
    rule: "Keeps the guarantee clean",
    how: "Whatever the tone elsewhere, the risk reversal carries no swearing or jokes.",
    find: (ad) => {
      const guarantee = beat(ad, (item) => item.code === "O_GUARANTEE");
      const swearsElsewhere = ad.lines.some((item) => PROFANITY.test(item.text));
      return guarantee && swearsElsewhere && !PROFANITY.test(guarantee.evidenceQuote) ? example(ad, guarantee.evidenceQuote, guarantee.startSec) : null;
    },
  },
  {
    key: "witness",
    rule: "Lets someone else notice the change",
    how: "A sister, a partner, a stranger remarks — proof from outside the buyer.",
    find: (ad) => {
      const hit = beat(ad, (item) => item.code === "PR_WITNESS");
      return hit ? example(ad, hit.evidenceQuote, hit.startSec) : null;
    },
  },
];

/**
 * Rules this brand follows in at least `minShare` of ads (and `minSupport` ads
 * in absolute terms), strongest first, each with up to three proofs from the
 * best-ranked ads.
 */
export function copyRules(ads: CopyAd[], options: { minSupport?: number; minShare?: number; examples?: number } = {}): CopyRule[] {
  const minSupport = options.minSupport ?? 3;
  const minShare = options.minShare ?? 0.5;
  const maxExamples = options.examples ?? 3;
  const ranked = byRank(ads);
  const rules: CopyRule[] = [];
  for (const detector of DETECTORS) {
    const hits = ranked.map((ad) => detector.find(ad)).filter((hit): hit is CopyExample => hit !== null);
    const share = pct(hits.length, ads.length);
    if (hits.length < minSupport || share < minShare) continue;
    rules.push({ key: detector.key, rule: detector.rule, how: detector.how, ads: hits.length, share, examples: hits.slice(0, maxExamples) });
  }
  return rules.sort((a, b) => b.share - a.share || b.ads - a.ads);
}

/** Content words used across many of the brand's ads: the vocabulary to keep. */
export function signatureWords(ads: CopyAd[], options: { minShare?: number; limit?: number } = {}): CopyProfile["signatureWords"] {
  const minShare = options.minShare ?? 0.4;
  const limit = options.limit ?? 15;
  const adsPerTerm = new Map<string, Set<string>>();
  for (const ad of ads) {
    const seen = new Set<string>();
    for (const item of ad.lines) {
      for (const token of tokens(item.text)) {
        if (token.length < 4 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
        seen.add(token);
      }
    }
    for (const token of seen) adsPerTerm.set(token, (adsPerTerm.get(token) ?? new Set()).add(ad.id));
  }
  return [...adsPerTerm.entries()]
    .map(([term, set]) => ({ term, ads: set.size, share: pct(set.size, ads.length) }))
    .filter((row) => row.share >= minShare && row.ads >= 2)
    .sort((a, b) => b.ads - a.ads || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export function copyProfile(ads: CopyAd[], options: { minSupport?: number } = {}): CopyProfile {
  return {
    adCount: ads.length,
    tone: toneStats(ads),
    rules: copyRules(ads, { minSupport: options.minSupport }),
    signatureWords: signatureWords(ads),
  };
}
