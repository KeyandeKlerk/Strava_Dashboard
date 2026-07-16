// Next.js 16 renamed middleware.ts -> proxy.ts (same mechanism). This is a
// simple password gate for a single-user dashboard, not a full auth/session
// system — see docs/guides/authentication's note that Proxy should only do
// optimistic checks, not be the sole authorization boundary. The real check
// for the login form itself lives in app/login/actions.ts.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token))) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api/webhook|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-).*)",
  ],
};
