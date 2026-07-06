"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchPlanStatus, type FetchPlanResult } from "@/app/(app)/create-plan/plan-draft-client";
import {
  completeWorkoutSession,
  fetchWorkoutSession,
  recordWorkoutSet,
  startWorkoutSession,
} from "./tracker-client";
import type { WorkoutSetUpdateInput } from "./tracker-types";
import type { WorkoutSessionRecord } from "@kinora/contracts";

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

async function unwrapWorkoutSession(
  resultPromise: Promise<
    | { kind: "ok"; session: WorkoutSessionRecord }
    | { kind: "error"; message: string }
  >,
): Promise<WorkoutSessionRecord> {
  const result = await resultPromise;
  if (result.kind === "error") {
    throw new Error(result.message);
  }

  return result.session;
}

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
  const token = await sessionToken();
  return fetchPlanStatus(planId, token);
}

export async function startWorkoutSessionAction(
  planId: string,
  day: number,
): Promise<WorkoutSessionRecord> {
  const token = await sessionToken();
  return unwrapWorkoutSession(startWorkoutSession(planId, day, token));
}

export async function getWorkoutSessionAction(
  sessionId: string,
): Promise<WorkoutSessionRecord> {
  const token = await sessionToken();
  return unwrapWorkoutSession(fetchWorkoutSession(sessionId, token));
}

export async function recordWorkoutSetAction(
  sessionId: string,
  setId: string,
  input: WorkoutSetUpdateInput,
): Promise<WorkoutSessionRecord> {
  const token = await sessionToken();
  return unwrapWorkoutSession(recordWorkoutSet(sessionId, setId, input, token));
}

export async function completeWorkoutSessionAction(
  sessionId: string,
): Promise<WorkoutSessionRecord> {
  const token = await sessionToken();
  return unwrapWorkoutSession(completeWorkoutSession(sessionId, token));
}
