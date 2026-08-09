"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchUserPlansWithProgress, type FetchPlansWithProgressResult } from "./plans-client";

/**
 * Server Action for the `/plans` list (17d PR A). Thin framework glue
 * (excluded from coverage; the branching logic lives in the unit-tested
 * `plans-client.ts`) — mirrors `listPlansAction` / `getWorkoutHistoryAction`.
 * Reads the opaque session token from the `kinora_session` httpOnly cookie;
 * the browser never calls the API directly.
 */
export async function listPlansWithProgressAction(): Promise<FetchPlansWithProgressResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchUserPlansWithProgress(token);
}
