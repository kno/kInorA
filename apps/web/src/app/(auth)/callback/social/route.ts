import { type NextRequest, NextResponse } from "next/server";
import { proxySocialCallback } from "./callback-proxy";

void NextResponse; // keep NextResponse referenced for the type tree in this module.

/**
 * Social OIDC callback route handler (Next.js App Router).
 *
 * Google (or any configured OIDC provider) redirects the user-agent here with
 * `code` + `state` query params after the user consents. This handler extracts
 * the params and delegates to `proxySocialCallback`, which proxies them to the
 * API `POST /auth/social/callback`. See `callback-proxy.ts` for the full
 * orchestration and session-cookie logic.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  return proxySocialCallback(request.nextUrl.searchParams, { origin });
}