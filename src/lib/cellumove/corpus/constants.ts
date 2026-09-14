// Corpus Miner — versions and limits.
//
// Every LLM stage stamps its prompt version, the taxonomy version, and the
// engine version on the rows it writes. That is what lets a changed number be
// traced back to either a changed input or a changed prompt. Bump a version
// here whenever the corresponding prompt or algorithm changes; never edit a
// prompt in place under the same version.

export const CORPUS_ENGINE_VERSION = "corpus-miner-v1";
export const CORPUS_TRANSCRIBE_PROMPT_VERSION = "corpus-transcribe-v1";
export const CORPUS_EXTRACT_PROMPT_VERSION = "corpus-extract-v1";
export const WINNER_SCORE_VERSION = "winner-score-v1";

/** Taxonomy the extractor selects from. Flip to v2 once the hand-built list is seeded. */
export const CORPUS_TAXONOMY_VERSION = process.env.CORPUS_TAXONOMY_VERSION?.trim() || "copy-taxonomy-v1";

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

export const TRANSCRIPT_CHANNELS = ["vo", "ost"] as const;
export type TranscriptChannel = (typeof TRANSCRIPT_CHANNELS)[number];
