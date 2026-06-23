import { NextResponse, type NextRequest } from "next/server";
import { evaluateAuthGate } from "./auth-gate";
import { SESSION_COOKIE } from "./auth/session-cookie";

/**
 * Next.js middleware — gates protected routes by checking for the
 * `kinora_session` cookie (presence only, no 401/403).
 *
 * 05a/05b seam: this middleware redirects unauthenticated users to
 * `/login`. It does NOT return 401/403 — 05b owns the reject policy.
 * The cookie-presence check mirrors `request.authContext` presence in the
 * API auth plugin: both are "is there a session?" checks with no
 * authorization semantics.
 *
 * Protected routes: `/dashboard`, `/plan`, `/profile` (and sub-paths).
 * Auth pages (`/login`, `/sign-up`, `/callback`, `/auth/social`) are
 * intentionally NOT protected — users must reach them without a session.
 */

export function middleware(request: NextRequest): NextResponse {
  const result = evaluateAuthGate({
    cookieValue: request.cookies.get(SESSION_COOKIE)?.value,
    pathname: request.nextUrl.pathname,
    origin: request.url,
  });

  if (result.kind === "redirect") {
    return NextResponse.redirect(new URL(result.location));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/plan/:path*", "/profile/:path*"],
};
