// Thumbnail proxy for b-roll clips: redirects to a freshly-minted Drive thumbnail
// (the stored thumbnailLink expires after a few hours). Sits behind the auth gate
// like every other route, so clip frames stay team-only.
import { NextResponse, type NextRequest } from "next/server";
import { getDriveThumbnailUrl } from "@/lib/drive";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ driveId: string }> },
) {
  const { driveId } = await params;
  if (!/^[\w-]{10,}$/.test(driveId)) return new NextResponse(null, { status: 400 });
  try {
    const url = await getDriveThumbnailUrl(driveId);
    if (!url) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(url, {
      status: 302,
      // Browser-cache the redirect for 30 min — well inside the Google URL's lifetime,
      // so repeat scrolling doesn't re-hit the Drive API for every card.
      headers: { "Cache-Control": "private, max-age=1800" },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
