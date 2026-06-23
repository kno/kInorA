import { NextResponse, type NextRequest } from "next/server";
import { evaluateAuthGate } from "./auth-gate";
import { SESSION_COOKIE } from "./auth/session-cookie";

/**
 * Next.js proxy (formerly middleware) — gates protected routes by
 * checking for the `kinora_session` cookie.
 *
 * 05b: unauthenticated API/XHR requests (detected via `Accept: application/json`
 * or `x-requested-with: XMLHttpRequest`) get a 401 JSON response. HTML
 * navigation requests redirect to `/login?from=` so browser users see the
 * login page.
 *
 * Protected routes: `/dashboard`, `/plan`, `/profile` (and sub-paths).
 * Auth pages (`/login`, `/sign-up`, `/callback`, `/auth/social`) are
 * intentionally NOT protected — users must reach them without a session.
 */

export function proxy(request: NextRequest): NextResponse | Response {
  const result = evaluateAuthGate({
    cookieValue: request.cookies.get(SESSION_COOKIE)?.value,
    pathname: request.nextUrl.pathname,
    origin: request.url,
    acceptHeader: request.headers.get("accept"),
    requestedWithHeader: request.headers.get("x-requested-with"),
  });

  if (result.kind === "redirect") {
    return NextResponse.redirect(new URL(result.location));
  }

  if (result.kind === "unauthorized") {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/plan/:path*", "/profile/:path*"],
};
