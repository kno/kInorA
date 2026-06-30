"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchPlanStatus, type FetchPlanResult } from "@/app/(app)/create-plan/plan-draft-client";

/**
 * Server Action for fetching plan status.
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `plan-draft-client.ts`). Reads the opaque session token from
 * the `kinora_session` httpOnly cookie and forwards it to `fetchPlanStatus` —
 * mirroring `create-plan/actions.ts`.
 *
 * The browser NEVER calls the API directly: PlanStatusClient calls this action,
 * Next.js runs it server-side (where API_BASE_URL=http://api:4000 resolves),
 * and the session token stays server-side.
 */
export async function getPlanStatusAction(planId: string): Promise<FetchPlanResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchPlanStatus(planId, token);
}
