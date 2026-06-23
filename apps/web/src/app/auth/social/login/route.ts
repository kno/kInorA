import { NextResponse, type NextRequest } from "next/server";
import { proxySocialLogin } from "./proxy";

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

  const result = await proxySocialLogin(provider, { origin });

  return NextResponse.redirect(new URL(result.location), { status: 302 });
}
