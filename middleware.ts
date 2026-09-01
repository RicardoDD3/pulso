import { NextRequest, NextResponse } from "next/server";

/**
 * UX reinforcement ONLY (spec doc 11, A2): redirects unauthenticated page
 * views to sign-in. It is NEVER the security boundary — every API handler
 * resolves its own Viewer and returns 401 JSON without a session.
 */
export function middleware(request: NextRequest) {
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/training/:path*",
    "/labs/:path*",
    "/coach/:path*",
    "/exercises/:path*",
    "/settings/:path*",
  ],
};
