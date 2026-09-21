import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native/runtime-loaded packages the server bundler must not touch: pdf.js
  // (Milanote PDF import) and sharp, whose native binding breaks if bundled —
  // which silently disables ad-image compression.
  serverExternalPackages: ["pdfjs-dist", "sharp"],
  // Guarantee pdf.js's worker is packaged with the Milanote import function on
  // Vercel even though pdf.js itself only references it dynamically.
  outputFileTracingIncludes: {
    "/image-ads/**": ["./assets/brand/cellumove-dark.png", "./assets/brand/cellumove-white.png"],
    "/api/scorer/evidence/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  experimental: {
    serverActions: {
      // Must stay above MAX_UPLOAD_BYTES (15MB) in framework-extraction.ts.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
