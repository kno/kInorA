import { type NextRequest, NextResponse } from "next/server";
import { proxySocialCallback } from "./callback-proxy";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  return proxySocialCallback(request.nextUrl.searchParams, { origin });
}
