import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // pdf.js (Milanote PDF import) must be loaded at runtime rather than bundled.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    serverActions: {
      // Must stay above MAX_UPLOAD_BYTES (15MB) in framework-extraction.ts.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
