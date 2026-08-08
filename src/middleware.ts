import { type NextRequest } from "next/server";
import { gate } from "@/lib/auth-gate";

export async function middleware(request: NextRequest) {
  return await gate(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
