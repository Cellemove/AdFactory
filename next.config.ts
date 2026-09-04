import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Must stay above MAX_UPLOAD_BYTES (15MB) in framework-extraction.ts.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
