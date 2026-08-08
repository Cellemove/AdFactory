import { NextResponse } from "next/server";

// Debug endpoint — reports presence (not value) of required env vars at runtime
// so we can confirm whether Vercel is actually injecting them into the function.
// Returns the deployment SHA so we know which build is responding.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    runtime: {
      isVercel: !!process.env.VERCEL,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      nodeVersion: process.version,
    },
    envPresent: {
      BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
      BLOB_READ_WRITE_TOKEN_length: process.env.BLOB_READ_WRITE_TOKEN?.length ?? 0,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GOOGLE_APPLICATION_CREDENTIALS_JSON: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? null,
      GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION ?? null,
    },
  });
}
