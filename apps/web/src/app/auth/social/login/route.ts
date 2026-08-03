import { NextResponse, type NextRequest } from "next/server";
import { proxySocialLogin } from "./proxy";
import { extractGymSlugFromHost } from "@/lib/gym-slug";

/**
 * Social login initiation route handler.
 *
 * The Google button on login/sign-up pages links to this endpoint:
 *   `/auth/social/login?provider=google`
 *
 * This handler proxies to the API `GET /auth/social/login?provider=google`,
 * which returns `{authorizationUrl, state}`. The handler then redirects the
 * user-agent (302) to the Google authorization URL. On error it redirects
 * to `/login?error=...`.
 *
 * Mirrors the callback proxy pattern from PR3.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const provider = request.nextUrl.searchParams.get("provider") ?? "";
  const origin = new URL(request.url).origin;

  // Capture the gym subdomain the login was initiated from (from the public
  // Host, honoring the reverse-proxy `x-forwarded-host`) so it can be
  // round-tripped through the OAuth state and land the user back on the
  // white-label subdomain after the callback.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost ?? request.headers.get("host") ?? "")
    .split(",")[0]!
    .trim();
  const originSlug = extractGymSlugFromHost(host) ?? undefined;

  const result = await proxySocialLogin(provider, { origin, originSlug });

  return NextResponse.redirect(new URL(result.location), { status: 302 });
}
