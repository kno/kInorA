"use server";

import { cookies } from "next/headers";
import type { WorkoutHistoryQuery } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchWorkoutHistory, type FetchHistoryResult } from "./history-client";

/**
 * Server Action for fetching paginated session history.
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `history-client.ts`) — mirrors `listPlansAction` /
 * `getPlanStatusAction`. Reads the opaque session token from the
 * `kinora_session` httpOnly cookie; the browser never calls the API directly.
 *
 * Sync-independent: this action never touches the offline mutation queue or
 * session snapshot cache (spec: "History available without pending sync
 * activity").
 */
export async function getWorkoutHistoryAction(
  query: WorkoutHistoryQuery = {},
): Promise<FetchHistoryResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchWorkoutHistory(token, query);
}
