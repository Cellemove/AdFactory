import { z } from "zod";

export const SpyNicheSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryTerms: z.array(z.string().trim().min(1)).min(1),
  brandExamples: z.array(z.string().trim().min(1)).default([]),
  rejectRules: z.array(z.string().trim().min(1)).min(1),
});

export type SpyNiche = z.infer<typeof SpyNicheSchema>;

const DEFAULT_SPY_NICHE: SpyNiche = {
    slug: "compression-leggings",
    name: "Compression & sculpting leggings",
    categoryTerms: [
      "3D shaping leggings",
      "sculpting leggings",
      "butt lift leggings",
      "snatched leggings",
      "anti-cellulite leggings",
      "tummy control leggings",
    ],
    brandExamples: ["FitSlim", "Peach Pump", "Trysoviren", "Honeylove", "Shapermint", "Yvette", "FeelinGirl", "AYBL"],
    rejectRules: ["CelluMove", "storefront or product pages", "SEO listicles", "affiliate roundups", "press releases", "AI content farms"],
  };

export const SPY_NICHES: SpyNiche[] = [
  DEFAULT_SPY_NICHE,
  {
    slug: "compression-socks",
    name: "Compression socks",
    categoryTerms: ["compression socks", "circulation socks", "travel compression socks", "recovery socks", "swollen leg relief socks"],
    brandExamples: ["Comrad", "Bombas", "Sockwell", "VIM & VIGR", "Physix Gear"],
    rejectRules: ["CelluMove", "medical diagnosis or cure claims", "storefront or product pages", "SEO listicles", "affiliate roundups"],
  },
  {
    slug: "shapewear",
    name: "Shapewear & bodysuits",
    categoryTerms: ["shapewear bodysuit", "tummy control shapewear", "waist smoothing bodysuit", "seamless shapewear", "sculpting bodysuit"],
    brandExamples: ["SKIMS", "Honeylove", "Shapermint", "Spanx", "FeelinGirl"],
    rejectRules: ["CelluMove", "storefront or product pages", "SEO listicles", "affiliate roundups", "press releases"],
  },
  {
    slug: "support-sleeves",
    name: "Compression sleeves & supports",
    categoryTerms: ["compression sleeve", "knee support sleeve", "arm compression sleeve", "recovery support wear", "joint support sleeve"],
    brandExamples: ["Copper Fit", "Bauerfeind", "Incrediwear", "Tommy Copper"],
    rejectRules: ["CelluMove", "medical diagnosis or cure claims", "storefront or product pages", "SEO listicles", "affiliate roundups"],
  },
];

export const DEFAULT_SPY_NICHE_SLUG = DEFAULT_SPY_NICHE.slug;

export function getSpyNiche(slug: string | null | undefined): SpyNiche {
  return SPY_NICHES.find((niche) => niche.slug === slug) ?? DEFAULT_SPY_NICHE;
}
