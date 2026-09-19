// Corpus Miner — versions and limits.
//
// Every LLM stage stamps its prompt version, the taxonomy version, and the
// engine version on the rows it writes. That is what lets a changed number be
// traced back to either a changed input or a changed prompt. Bump a version
// here whenever the corresponding prompt or algorithm changes; never edit a
// prompt in place under the same version.

// v2: the validator repairs numbering, channel and unambiguous drifted timecodes
// itself instead of re-calling the model (see extract.ts, evidence-gate.ts).
export const CORPUS_ENGINE_VERSION = "corpus-miner-v2";
export const CORPUS_TRANSCRIBE_PROMPT_VERSION = "corpus-transcribe-v2";
// v3: response schema with the taxonomy codes as an enum; retry note moved to the end.
export const CORPUS_EXTRACT_PROMPT_VERSION = "corpus-extract-v3";
export const WINNER_SCORE_VERSION = "winner-score-v1";

/** Taxonomy the extractor selects from: v2 is the named-beat list built from the strategist's script board. */
export const CORPUS_TAXONOMY_VERSION = process.env.CORPUS_TAXONOMY_VERSION?.trim() || "copy-taxonomy-v2";

/** Vertex inline request cap is ~20MB; base64 inflates by 4/3, so 15MB of video is the ceiling. */
export const CORPUS_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

/** fuzzy partial-ratio (0..100) an evidence quote must reach against a transcript segment. */
export const EVIDENCE_GATE_THRESHOLD = 90;

/** Minimum ads a pattern must appear in before MINE reports it. */
export const MINE_MIN_SUPPORT = 5;
/** Share of ads in which X precedes Y for the pair to be called a positional law. */
export const MINE_LAW_SHARE = 0.95;
/** Scored ads required before top-vs-bottom quartile lift is computed. */
export const MINE_MIN_SCORED_FOR_LIFT = 8;
/** A single brand contributing more than this share of a cohort is flagged (house-style trap). */
export const MINE_MAX_BRAND_SHARE = 0.3;

/**
 * Media statuses the download stage has given up on: the ad has no usable video
 * and nothing downstream can run on it. Excluded from the denominators that ask
 * "how much of this brand have we analysed", so a brand whose every reachable ad
 * is done reads as done rather than permanently preliminary.
 */
export const MEDIA_FAILED = new Set(["failed", "oversize", "unavailable", "expired", "not_video"]);

/** Private Supabase Storage bucket holding the downloaded videos (migration 019). */
export const CORPUS_MEDIA_BUCKET = "corpus-media";

export const USAGE_FEATURES = {
  transcribe: "corpus_transcribe",
  extract: "corpus_extract",
  eval: "corpus_eval",
} as const;

/** Gate 1 thresholds from the spec: 80% layer agreement, 70% code agreement. */
export const GATE1_LAYER_THRESHOLD = 0.8;
export const GATE1_CODE_THRESHOLD = 0.7;

/** The two channels a beat may quote: spoken words and on-screen text. */
export const TRANSCRIPT_CHANNELS = ["vo", "ost"] as const;
export type TranscriptChannel = (typeof TRANSCRIPT_CHANNELS)[number];

/**
 * The third transcript channel: one line per shot saying what is on screen and
 * the editing cue. Context for the extractor and material for the playbook's
 * visual direction; never evidence, so beats cannot quote it.
 */
export const VISUAL_CHANNEL = "vis" as const;
export const SEGMENT_CHANNELS = [...TRANSCRIPT_CHANNELS, VISUAL_CHANNEL] as const;
export type SegmentChannel = (typeof SEGMENT_CHANNELS)[number];
