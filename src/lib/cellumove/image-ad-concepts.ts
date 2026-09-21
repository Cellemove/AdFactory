// Concept model for a batch of static image ads, plus the pure rules that decide
// the batch mix. Kept free of server imports so both the planner action and the
// client gallery can use the types, and so the counting rules stay testable.
import type { ImageAdReferenceRole } from "./image-ad-references";

export type ImageAdCandidateStatus = "planned" | "generating" | "ready" | "failed";
export type ImageAdConceptSource = "reference_informed" | "original";

export interface ImageAdConcept {
  direction: string;        // the message direction this execution belongs to
  execution: string;        // short label for the visual treatment
  headline: string;
  bodyCopy: string;
  cta: string;
  visualInstructions: string; // the brief the image model renders from
  rationale: string;
  source: ImageAdConceptSource;
  sourceReferenceIds: string[];
  rolesUsed: ImageAdReferenceRole[];
}

export interface ImageAdCandidate {
  slot: number;
  concept: ImageAdConcept;
  status: ImageAdCandidateStatus;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  attempts: number;
  error: string | null;
  generatedAt: string | null;
  logoAppliedAt?: string;
  // Retained when adding the logo to an older render, so the source is recoverable.
  unbrandedImageUrl?: string;
  // Result of the existing claim scan over the concept copy. Advisory: it flags
  // wording for a human, it does not block generation.
  claimStatus?: "clean" | "warn" | "flagged";
  claimFlags?: string[];
}

// 60–70% reference-informed, 30–40% original, rounded to whole candidates while
// preserving the exact requested total. Two thirds sits inside the band for every
// supported batch size.
export function referenceInformedCount(total: number): number {
  return Math.round(total * (2 / 3));
}

export function planSourceMix(total: number): ImageAdConceptSource[] {
  const referenceInformed = referenceInformedCount(total);
  return Array.from({ length: total }, (_, index) =>
    index < referenceInformed ? "reference_informed" : "original");
}

// Directions × executions. Five executions per direction is the documented shape;
// the last direction absorbs the remainder so the total is always exact.
export function planDirectionSizes(total: number, perDirection = 5): number[] {
  if (total <= 0) return [];
  const sizes: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const size = Math.min(perDirection, remaining);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

export function candidateCounts(candidates: ImageAdCandidate[]): {
  total: number;
  ready: number;
  failed: number;
  pending: number;
} {
  return {
    total: candidates.length,
    ready: candidates.filter((candidate) => candidate.status === "ready").length,
    failed: candidates.filter((candidate) => candidate.status === "failed").length,
    pending: candidates.filter((candidate) => candidate.status !== "ready").length,
  };
}

// A batch is complete only when every requested slot has a current rendered
// image. Failed and half-finished work never counts toward the target.
export function batchComplete(candidates: ImageAdCandidate[], targetCount: number): boolean {
  return candidates.length === targetCount && candidateCounts(candidates).ready === targetCount;
}

function normalizeHeadline(headline: string): string {
  return headline.toLocaleLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Cheap near-duplicate flag: identical normalized headlines, or one headline
// wholly contained in another. Runs before rendering so we do not pay to render
// the same ad twice.
export function duplicateHeadlineSlots(candidates: ImageAdCandidate[]): number[] {
  const duplicates: number[] = [];
  const seen: { slot: number; headline: string }[] = [];
  for (const candidate of candidates) {
    const headline = normalizeHeadline(candidate.concept.headline);
    if (!headline) continue;
    const clash = seen.find((earlier) =>
      earlier.headline === headline ||
      earlier.headline.includes(headline) ||
      headline.includes(earlier.headline));
    if (clash) duplicates.push(candidate.slot);
    else seen.push({ slot: candidate.slot, headline });
  }
  return duplicates;
}
