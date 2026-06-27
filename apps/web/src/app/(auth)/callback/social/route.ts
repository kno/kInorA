import { type NextRequest, NextResponse } from "next/server";
import { proxySocialCallback } from "./callback-proxy";
import { resolvePublicOrigin } from "./origin";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = resolvePublicOrigin(request);
  return proxySocialCallback(request.nextUrl.searchParams, { origin });
}
