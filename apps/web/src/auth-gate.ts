/**
 * Pure auth-gate decision logic for the Next.js proxy.
 *
 * Extracted so the redirect-vs-pass-vs-401 decision can be unit-tested without
 * constructing real NextRequest objects. The proxy wraps this: it reads the
 * cookie, pathname, and headers from the request, calls `evaluateAuthGate`,
 * and returns the appropriate NextResponse.
 *
 * 05b: unauthenticated requests now fail closed. API/XHR clients (detected
 * via `Accept: application/json` or `x-requested-with: XMLHttpRequest`) get
 * a 401 JSON response instead of a redirect. HTML navigation still redirects
 * to `/login?from=` so browser users see the login page.
 */

export type AuthGateResult =
  | { kind: "pass" }
  | { kind: "redirect"; location: string }
  | { kind: "unauthorized" };

export function evaluateAuthGate(input: {
  cookieValue: string | undefined;
  pathname: string;
  origin: string;
  acceptHeader?: string | null;
  requestedWithHeader?: string | null;
}): AuthGateResult {
  const hasSession =
    !!input.cookieValue && input.cookieValue.trim().length > 0;

  if (!hasSession) {
    const isApiRequest =
      (input.acceptHeader?.includes("application/json") ?? false) ||
      (input.requestedWithHeader?.includes("XMLHttpRequest") ?? false);

    if (isApiRequest) {
      return { kind: "unauthorized" };
    }

    const url = new URL("/login", input.origin);
    url.searchParams.set("from", input.pathname);
    return { kind: "redirect", location: url.toString() };
  }

  return { kind: "pass" };
}
