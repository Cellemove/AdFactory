// The 7 hardcoded angles. Each carries the mechanism, banned-mechanism, silhouette,
// colorway, and the required-keyword that compliance.ts uses to detect drift.
//
// Silhouette + colorway rules (CLAUDE.md hard rule #3):
//   Varicose Veins = full-length + black.
//   All others     = short-legging + pink.

export type AngleSlug =
  | "anti-cellulite"
  | "lipoedema"
  | "varicose-veins"
  | "heavy-legs"
  | "post-pregnancy"
  | "menopause"
  | "promo";

export interface AngleSpec {
  slug: AngleSlug;
  name: string;
  requiredKeyword: string;       // must appear (case-insensitive) somewhere in the prompt
  mechanism: string;             // mechanism this angle MUST show
  bannedMechanism: string;       // mechanisms from OTHER angles that auto-reject if present
  silhouette: "short-legging" | "full-length";
  colorway: "pink" | "black";
  order: number;
}

// Looser shape used at runtime for user-created angles that aren't in the
// hardcoded ANGLE_BY_SLUG map. Carries the same logical fields but accepts any
// string for silhouette/colorway/slug.
export interface RuntimeAngleSpec {
  slug: string;
  name: string;
  requiredKeyword: string;
  mechanism: string;
  bannedMechanism: string;
  silhouette: string;
  colorway: string;
}

// Resolve a slug to an AngleSpec-shaped object, preferring the explicit override
// (typically loaded from DB for user-created angles) and falling back to the
// hardcoded map for the 7 seeded angles.
export function resolveAngle(
  slug: string,
  override?: RuntimeAngleSpec | null,
): RuntimeAngleSpec | null {
  if (override && override.slug === slug) return override;
  const seeded = (ANGLE_BY_SLUG as Record<string, AngleSpec | undefined>)[slug];
  return seeded ?? override ?? null;
}

export const ANGLES: AngleSpec[] = [
  {
    slug: "anti-cellulite",
    name: "Anti-Cellulite",
    requiredKeyword: "cellulite",
    mechanism: "dimpling / surface micro-texture cue on upper thigh, softened by compression",
    bannedMechanism: "lymphatic | venous valve | vein bulge",
    silhouette: "short-legging",
    colorway: "pink",
    order: 1,
  },
  {
    slug: "lipoedema",
    name: "Lipoedema",
    requiredKeyword: "lipoedema",
    mechanism: "lymphatic drainage cue — soft directional flow lines along the leg, gentle massage hint",
    bannedMechanism: "dimpling | venous valve | vein bulge",
    silhouette: "short-legging",
    colorway: "pink",
    order: 2,
  },
  {
    slug: "varicose-veins",
    name: "Varicose Veins",
    requiredKeyword: "varicose",
    mechanism: "venous valve / vein support cue — subtle calf compression, blood-return arrows or gradient",
    bannedMechanism: "dimpling | lymphatic | orange peel",
    silhouette: "full-length",
    colorway: "black",
    order: 3,
  },
  {
    slug: "heavy-legs",
    name: "Heavy Legs",
    requiredKeyword: "heavy legs",
    mechanism: "venous return cue — end-of-day relief, lightness, calf decompression",
    bannedMechanism: "dimpling | lymphatic",
    silhouette: "short-legging",
    colorway: "pink",
    order: 4,
  },
  {
    slug: "post-pregnancy",
    name: "Post-Pregnancy",
    requiredKeyword: "post-pregnancy",
    mechanism: "abdominal + leg support cue, gentle silhouette restoration, NOT weight-loss framing",
    bannedMechanism: "weight loss | fat burning | belly fat",
    silhouette: "short-legging",
    colorway: "pink",
    order: 5,
  },
  {
    slug: "menopause",
    name: "Menopause",
    requiredKeyword: "menopause",
    mechanism: "circulation + hormonal-era leg comfort cue, midlife-confident framing",
    bannedMechanism: "anti-aging miracle | weight loss",
    silhouette: "short-legging",
    colorway: "pink",
    order: 6,
  },
  {
    slug: "promo",
    name: "Promo",
    requiredKeyword: "", // promo inherits — keyword check skipped
    mechanism: "promotion-forward layout — price/offer hierarchy, product as hero, trust text bottom",
    bannedMechanism: "70% off | extreme discount",
    silhouette: "short-legging", // inherits from parent at brief time
    colorway: "pink",
    order: 7,
  },
];

export const ANGLE_BY_SLUG: Record<AngleSlug, AngleSpec> = Object.fromEntries(
  ANGLES.map((a) => [a.slug, a]),
) as Record<AngleSlug, AngleSpec>;

export function angleFromSlug(slug: string): AngleSpec | undefined {
  return ANGLES.find((a) => a.slug === slug);
}
