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

/**
 * Result of the start-workout server action (#93 F1).
 *
 * Start is the ONE path that can hit a 409 `active_session_conflict` (the
 * `/plan/[id]` page renders a Start button per day). A conflict is a normal,
 * expected outcome — NOT an exception — so we surface it as a structured branch
 * instead of throwing. Throwing here would crash the page render. The
 * `started`/`resumed` success shape is unchanged for callers.
 */
export type StartWorkoutSessionActionResult =
  | { kind: "started" | "resumed"; session: WorkoutSessionRecord }
  | { kind: "conflict"; activePlanName?: string; activeDay?: number | null };

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
): Promise<StartWorkoutSessionActionResult> {
  const token = await sessionToken();
  const result = await startWorkoutSession(planId, day, token);

  if (result.kind === "ok") {
    // The API distinguishes started vs resumed via HTTP status, but both return
    // the same 200 session snapshot here; the client only needs the session, so
    // we normalize to "resumed" (idempotent from the caller's perspective).
    return { kind: "resumed", session: result.session };
  }

  // A 409 active_session_conflict is a structured branch, NOT a throw — throwing
  // would crash the /plan/[id] render (one Start button per day can trigger it).
  if (result.message === "active_session_conflict") {
    return {
      kind: "conflict",
      activePlanName: result.activePlanName,
      activeDay: result.activeDay,
    };
  }

  // Any other error (network, not_found, invalid_response) stays a throw so the
  // existing error boundary behavior is preserved for genuinely broken states.
  throw new Error(result.message);
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
