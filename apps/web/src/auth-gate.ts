/**
 * Pure auth-gate decision logic for the Next.js middleware.
 *
 * Extracted so the redirect-vs-pass decision can be unit-tested without
 * constructing real NextRequest objects. The middleware wraps this: it
 * reads the cookie and pathname from the request, calls `evaluateAuthGate`,
 * and returns the appropriate NextResponse.
 *
 * 05a/05b seam: this is a PRESENCE check only — no 401/403. The middleware
 * simply redirects unauthenticated users to `/login`. 05b owns reject
 * policy (401/403 error responses).
 */

export type AuthGateResult =
  | { kind: "pass" }
  | { kind: "redirect"; location: string };

export function evaluateAuthGate(input: {
  cookieValue: string | undefined;
  pathname: string;
  origin: string;
}): AuthGateResult {
  const hasSession =
    !!input.cookieValue && input.cookieValue.trim().length > 0;

  if (!hasSession) {
    const url = new URL("/login", input.origin);
    url.searchParams.set("from", input.pathname);
    return { kind: "redirect", location: url.toString() };
  }

  return { kind: "pass" };
}
