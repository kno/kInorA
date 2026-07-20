"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  fetchUserPlans,
  type FetchUserPlansResult,
} from "@/app/(app)/create-plan/plan-draft-client";
import { fetchWeeklyOverview, type FetchWeeklyOverviewResult } from "./weekly-overview-client";

/**
 * Server Action for listing the authenticated user's workout plan summaries.
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `plan-draft-client.ts`). Reads the opaque session token from
 * the `kinora_session` httpOnly cookie and forwards it to `fetchUserPlans` —
 * mirroring `getPlanStatusAction` from plan/[id]/actions.ts.
 *
 * The browser NEVER calls the API directly: the /plan server component calls
 * this action, Next.js runs it server-side (where API_BASE_URL=http://api:4000
 * resolves), and the session token stays server-side.
 */
export async function listPlansAction(): Promise<FetchUserPlansResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchUserPlans(token);
}

/**
 * Server Action fetching the weekly plan-board overview
 * (09c-v1-progress-dashboard-stats, Slice 4b) — the real done/active/rest/
 * soon day states plus prev/next week navigation. `weekStart` is an ISO
 * `YYYY-MM-DD` date (the requested Monday), or `undefined` for the current
 * week. Thin framework glue — mirrors `getDashboardAction`.
 */
export async function getWeeklyOverviewAction(weekStart?: string): Promise<FetchWeeklyOverviewResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchWeeklyOverview(token, weekStart);
}
