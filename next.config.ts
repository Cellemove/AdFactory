import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // pdf.js (Milanote PDF import) must be loaded at runtime rather than bundled.
  serverExternalPackages: ["pdfjs-dist"],
  // Guarantee pdf.js's worker is packaged with the Milanote import function on
  // Vercel even though pdf.js itself only references it dynamically.
  outputFileTracingIncludes: {
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
