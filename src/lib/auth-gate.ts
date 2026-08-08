// Route gate — runs on every request (see src/middleware.ts). Verifies the signed
// session cookie (edge-safe Web Crypto), redirects unauthenticated users to /login,
// bounces logged-in users off /login, and restricts editors to /reviews.
import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export async function gate(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const isAuthRoute = path === "/login";

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (isAuthRoute) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (path !== "/") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  const home = session.role === "editor" ? "/reviews" : "/";

  // Logged-in users shouldn't sit on /login.
  if (isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Editors are limited to their reviews workspace.
  if (session.role === "editor" && !path.startsWith("/reviews")) {
    const url = request.nextUrl.clone();
    url.pathname = "/reviews";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
