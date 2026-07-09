import { NextResponse, type NextRequest } from "next/server";
import { evaluateAuthGate } from "./auth-gate";
import { SESSION_COOKIE } from "./auth/session-cookie";

/**
 * Next.js proxy (formerly middleware) — gates protected routes by
 * checking for the `kinora_session` cookie, AND forwards `?lang=` as the
 * `x-kinora-lang` header for `getRequestConfig` (src/i18n/request.ts) to
 * resolve. Next.js 16 allows only ONE proxy/middleware file per app, so
 * both concerns live here rather than in a separate `middleware.ts`.
 *
 * 05b: unauthenticated API/XHR requests (detected via `Accept: application/json`
 * or `x-requested-with: XMLHttpRequest`) get a 401 JSON response. HTML
 * navigation requests redirect to `/login?from=` so browser users see the
 * login page.
 *
 * Protected routes: `/dashboard`, `/plan`, `/profile`, `/stats`,
 * `/create-plan`, `/exercises` (and sub-paths) — checked explicitly by
 * pathname below, since `matcher` now covers the whole site (minus
 * `/_next/*`, static assets, and `/api/*`) so the `?lang=` header logic runs
 * everywhere.
 *
 * `?lang=` → `x-kinora-lang` header injection is stateless (no cookies): a
 * bare follow-up request still falls through to `Accept-Language`.
 * Anti-spoofing: when `?lang=` is ABSENT, any client-supplied
 * `x-kinora-lang` header is actively DELETED before forwarding, so a client
 * cannot bypass `Accept-Language` resolution by setting the header directly.
 */

const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/plan",
  "/profile",
  "/stats",
  "/create-plan",
  "/exercises",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function proxy(request: NextRequest): NextResponse | Response {
  const requestHeaders = new Headers(request.headers);
  const lang = request.nextUrl.searchParams.get("lang");

  if (lang !== null) {
    try {
      requestHeaders.set("x-kinora-lang", lang);
    } catch {
      // Malformed value (e.g. control chars) — fail soft: treat as absent so
      // resolution falls through to Accept-Language rather than 500ing.
      requestHeaders.delete("x-kinora-lang");
    }
  } else {
    requestHeaders.delete("x-kinora-lang");
  }

  if (isProtectedPath(request.nextUrl.pathname)) {
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
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!_next/|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map|json|woff|woff2|ttf)$).*)",
  ],
};
