// Reference-ad selection rules for the AI Ads Image Bank. Every batch must be
// anchored to 3–5 BrandSearch winner images spanning at least two competitors,
// each carrying at least one inspiration role. Pure functions only — both the
// picker (client) and the server action validate with the same code.

export const IMAGE_AD_REFERENCE_ROLES = [
  { value: "hook_message", label: "Hook / message" },
  { value: "layout_hierarchy", label: "Layout / hierarchy" },
  { value: "visual_format", label: "Visual format" },
  { value: "product_presentation", label: "Product presentation" },
  { value: "proof_mechanism", label: "Proof mechanism" },
] as const;

export type ImageAdReferenceRole = (typeof IMAGE_AD_REFERENCE_ROLES)[number]["value"];

export interface ImageAdReferenceSelection {
  adId: string;
  roles: ImageAdReferenceRole[];
}

export interface ImageAdReferenceCandidate {
  id: string;
  brandName: string;
  provider: string;
  mediaType: string;
  imageUrl: string | null;
  winnerEvidence: string;
}

export interface ImageAdReferenceOption extends ImageAdReferenceCandidate {
  platform: string;
  sourceUrl: string | null;
  copy: string;
  evidenceReasons: unknown;
  metrics: unknown;
}

// Quality floor for a reference image, calibrated against what BrandSearch
// actually serves: its full-size creatives top out around 600px (600×600 feed,
// 338×600 story), and ads that never had a full image fall back to a 120×200
// thumbnail. The floor keeps every real creative and rejects the thumbnails,
// which tell a vision model almost nothing about layout or product presentation.
export const MIN_REFERENCE_SHORT_SIDE = 320;
export const MIN_REFERENCE_PIXELS = 150_000;
export const MIN_REFERENCE_BYTES = 8 * 1024;

export interface ImageAdReferenceQuality {
  width: number;
  height: number;
  byteSize: number;
}

// Dimension half of the check, shared with the picker: the browser knows an
// image's natural size as soon as it loads, so unusable ads are marked before
// the strategist spends a selection on them.
export function referenceDimensionsTooSmall(width: number, height: number): boolean {
  return Math.min(width, height) < MIN_REFERENCE_SHORT_SIDE || width * height < MIN_REFERENCE_PIXELS;
}

export function referenceImageQualityError(
  quality: ImageAdReferenceQuality,
  brandName: string,
): string | null {
  const { width, height, byteSize } = quality;
  if (byteSize < MIN_REFERENCE_BYTES) {
    return `The ${brandName} reference is only ${Math.round(byteSize / 1024)}KB — too small to be a usable ad image. Pick another.`;
  }
  if (referenceDimensionsTooSmall(width, height)) {
    return `The ${brandName} reference is only ${width}×${height} — a thumbnail, not the full ad. Pick another.`;
  }
  return null;
}

// What the batch stores. BrandSearch media URLs expire, so the archived copy —
// not `providerImageUrl` — is what the bank renders and hands to generation.
export interface ImageAdReferenceSnapshot {
  adId: string;
  provider: string;
  externalId: string;
  brandName: string;
  platform: string;
  sourceUrl: string | null;
  providerImageUrl: string;
  archivedImageUrl: string;
  copy: string;
  winnerEvidence: string;
  evidenceReasons: unknown;
  metrics: unknown;
  selectedAt: string;
  roles: ImageAdReferenceRole[];
  analysis: string;
  // Measured from the archived bytes. Optional so snapshots saved before the
  // quality check still parse — `referenceNeedsRearchive` re-fetches those.
  width?: number;
  height?: number;
  byteSize?: number;
}

// True when a stored reference predates the quality check and has no measured
// dimensions, so its archived copy must be re-fetched and re-verified.
export function referenceNeedsRearchive(reference: ImageAdReferenceSnapshot): boolean {
  return !reference.width || !reference.height || !reference.byteSize;
}

const ROLE_VALUES = new Set<string>(IMAGE_AD_REFERENCE_ROLES.map((role) => role.value));

export function imageAdReferenceSelectionError(
  selections: ImageAdReferenceSelection[],
  candidates: ImageAdReferenceCandidate[],
): string | null {
  if (selections.length < 3 || selections.length > 5) {
    return "Select 3–5 winning image ads.";
  }
  const uniqueIds = new Set(selections.map((selection) => selection.adId));
  if (uniqueIds.size !== selections.length) return "Each reference ad can only be selected once.";

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const selection of selections) {
    const candidate = byId.get(selection.adId);
    if (!candidate) return "One or more selected ads are no longer available.";
    if (candidate.provider !== "brandsearch") return "References must come from BrandSearch.";
    if (candidate.mediaType !== "image" || !candidate.imageUrl) return "Every reference must be a usable image ad.";
    if (!["probable_winner", "verified_winner"].includes(candidate.winnerEvidence)) {
      return "Every reference must qualify as a probable or verified winner.";
    }
    if (selection.roles.length === 0) return "Assign at least one inspiration role to every reference.";
    if (selection.roles.some((role) => !ROLE_VALUES.has(role))) return "A selected inspiration role is invalid.";
  }

  const brands = new Set(
    selections.map((selection) => byId.get(selection.adId)!.brandName.trim().toLocaleLowerCase()).filter(Boolean),
  );
  if (brands.size < 2) return "Choose references from at least two competitors.";
  return null;
}

// A saved snapshot set re-validated against itself: the batch is only ready for
// concept work when the stored references still satisfy the same rules.
export function imageAdReferencesReady(references: ImageAdReferenceSnapshot[] | undefined): boolean {
  if (!references) return false;
  return imageAdReferenceSelectionError(
    references.map((reference) => ({ adId: reference.adId, roles: reference.roles })),
    references.map((reference) => ({
      id: reference.adId,
      brandName: reference.brandName,
      provider: reference.provider,
      mediaType: "image",
      imageUrl: reference.archivedImageUrl,
      winnerEvidence: reference.winnerEvidence,
    })),
  ) === null;
}
