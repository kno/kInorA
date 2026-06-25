import { NextResponse } from "next/server";

/**
 * Social OIDC callback proxy logic — extracted from the route handler so it
 * can be unit-tested with a mock `fetch` and so the route module exports only
 * valid Next.js Route handlers.
 *
 * Google (or any configured OIDC provider) redirects the user-agent to the
 * callback route with `code` + `state` query params after the user consents.
 * This logic proxies the params to the API `POST /auth/social/callback`
 * (provider-agnostic): the API owns the code exchange, account
 * provisioning/linking, and session issuance. On success it redirects to the
 * app home and stores the opaque session token in an httpOnly cookie; on any
 * failure it redirects to the login page with an `error` query param.
 *
 * The session cookie name is `kinora_session` — the proxy reads the same
 * cookie to gate protected routes. Keeping the cookie write here (not in the
 * route) is intentional: the callback is where the API-issued token arrives.
 */

export const SESSION_COOKIE = "kinora_session";
/** Session cookie lifetime: 7 days. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const HOME_PATH = "/";
const LOGIN_PATH = "/login";

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function redirectToLogin(error: string, origin?: string): NextResponse {
  const base = origin ?? "http://localhost";
  const url = new URL(LOGIN_PATH, base);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * Pure orchestration of the callback proxy — extracted so it can be unit-tested
 * with a mock `fetch` without constructing a real NextRequest. Returns the
 * NextResponse the route should return.
 *
 * @param searchParams - The incoming request query params (code + state).
 * @param options.fetchImpl - Mock fetch for tests (defaults to global fetch).
 * @param options.apiBaseUrl - API base for the callback POST (defaults to env).
 * @param options.origin - App origin for redirect URLs (defaults to http://localhost for tests).
 */
export async function proxySocialCallback(
  searchParams: URLSearchParams,
  options: {
    fetchImpl?: typeof fetch;
    apiBaseUrl?: string;
    origin?: string;
  } = {}
): Promise<NextResponse> {
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return redirectToLogin("missing_params", options.origin);
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/social/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
  } catch {
    return redirectToLogin("api_unreachable", options.origin);
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return redirectToLogin(payload.error ?? "social_login_failed", options.origin);
  }

  const session = (await res.json().catch(() => ({}))) as { token?: string };

  // The API responded ok but issued no token — treat as a failed login
  // instead of silently redirecting home with no session (redirect loop).
  if (!session.token) {
    return redirectToLogin("missing_token", options.origin);
  }

  const url = new URL(HOME_PATH, options.origin ?? "http://localhost");
  const next = NextResponse.redirect(url, { status: 303 });

  next.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return next;
}