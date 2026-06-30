"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  fetchUserPlans,
  type FetchUserPlansResult,
} from "@/app/(app)/create-plan/plan-draft-client";

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
