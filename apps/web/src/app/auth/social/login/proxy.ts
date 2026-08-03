/**
 * Pure social-login initiation proxy.
 *
 * The Google (or any OIDC provider) button on login/sign-up pages links to
 * `/auth/social/login?provider=google`. The API `GET /auth/social/login`
 * returns JSON `{authorizationUrl, state}` — it does NOT redirect the
 * user-agent. This proxy fetches the authorization URL from the API and
 * returns the redirect target so the route handler can issue a 302.
 *
 * Extracted for unit-testability (mirrors `proxySocialCallback` from PR3).
 */

export type SocialLoginProxyResult =
  | { kind: "redirect"; location: string }
  | { kind: "error"; location: string };

export async function proxySocialLogin(
  provider: string,
  options: {
    fetchImpl?: typeof fetch;
    apiBaseUrl?: string;
    origin?: string;
    originSlug?: string;
  } = {}
): Promise<SocialLoginProxyResult> {
  const origin = options.origin ?? "http://localhost";

  if (!provider) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "missing_provider");
    return { kind: "error", location: url.toString() };
  }

  const base = options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://localhost:4000";
  const fetchImpl = options.fetchImpl ?? fetch;

  // Forward the origin gym slug to the API so it can round-trip it through the
  // OAuth state and the callback can redirect back to the white-label
  // subdomain. Omitted for apex logins.
  const query = new URLSearchParams({ provider });
  if (options.originSlug) {
    query.set("originSlug", options.originSlug);
  }

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/social/login?${query.toString()}`, {
      method: "GET",
    });
  } catch {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "api_unreachable");
    return { kind: "error", location: url.toString() };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const url = new URL("/login", origin);
    url.searchParams.set("error", payload.error ?? "social_login_failed");
    return { kind: "error", location: url.toString() };
  }

  const body = (await res.json().catch(() => ({}))) as {
    authorizationUrl?: string;
    state?: string;
  };

  if (!body.authorizationUrl) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "no_authorization_url");
    return { kind: "error", location: url.toString() };
  }

  return { kind: "redirect", location: body.authorizationUrl };
}
