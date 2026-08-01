"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  fetchTrainerPlan,
  type FetchTrainerPlanResult,
} from "@/app/(app)/create-plan/plan-draft-client";

/**
 * Server Action for the client-facing branded-plan view
 * (15b-v2-trainer-dashboard-branding, Phase S5).
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `fetchTrainerPlan` in `plan-draft-client.ts`). Reads the
 * opaque session token from the `kinora_session` httpOnly cookie and forwards
 * it to `fetchTrainerPlan` — mirroring `getPlanStatusAction` from
 * `plan/[id]/actions.ts`.
 *
 * The browser NEVER calls the API directly: the `/trainer-plan` server
 * component calls this action, Next.js runs it server-side (where
 * API_BASE_URL=http://api:4000 resolves), and the session token stays
 * server-side.
 */
export async function getTrainerPlanAction(): Promise<FetchTrainerPlanResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchTrainerPlan(token);
}
