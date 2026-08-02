"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchLogs } from "./logs-client";
import type { LogFilters, LogsResult } from "./logs-constants";

/**
 * Server Actions for the admin observability logs panel (GH #310, Slice 2).
 *
 * Thin framework glue (the branching + querystring logic lives in the
 * unit-tested `logs-client.ts`). Reads the opaque session token from the
 * `kinora_session` httpOnly cookie and forwards it as a Bearer token to the API
 * server-to-server — the browser never calls the API directly, and the token
 * never reaches client JS. Mirrors `tenants/actions.ts`.
 */

async function token(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function fetchLogsAction(filters: LogFilters): Promise<LogsResult> {
  return fetchLogs(await token(), filters);
}
