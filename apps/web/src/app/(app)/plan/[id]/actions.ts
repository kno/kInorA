"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchPlanStatus, type FetchPlanResult } from "@/app/(app)/create-plan/plan-draft-client";
import {
  completeWorkoutSession,
  fetchAuthIdentity,
  fetchWorkoutSession,
  recordWorkoutSet,
  startWorkoutSession,
} from "./tracker-client";
import type { WorkoutSetUpdateInput } from "./tracker-types";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import type { WorkoutSessionResult } from "./tracker-client";
import { WorkoutSessionActionError } from "./action-errors";

/**
 * Result of the start-workout server action (#93 F1).
 *
 * Start is the ONE path that can hit a 409 `active_session_conflict` (the
 * `/plan/[id]` page renders a Start button per day). A conflict is a normal,
 * expected outcome — NOT an exception — so we surface it as a structured branch
 * instead of throwing. Throwing here would crash the page render.
 *
 * The HTTP boundary does not carry the started/resumed distinction (the API
 * 200 response is the same shape for both); the web action normalises to a
 * single `kind:"ok"` success branch.
 */
export type StartWorkoutSessionActionResult =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | { kind: "conflict"; activePlanName?: string; activeDay?: number | null };

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

async function unwrapWorkoutSession(
  resultPromise: Promise<WorkoutSessionResult>,
): Promise<WorkoutSessionRecord> {
  const result = await resultPromise;
  if (result.kind === "error") {
    // Defensive fallback: any caller that omits `code` (e.g. the 409 conflict
    // shape reused for start, or a not-yet-migrated mock) is treated as a
    // retryable server-side failure, never silently poison-dropped.
    throw new WorkoutSessionActionError(result.message, result.code ?? "SERVER");
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

/**
 * Resolves an opaque, PER-ACCOUNT identity key for scoping the client-side
 * offline store (Phase 4 web offline design: "Local store is scoped per
 * authenticated identity and cleared on logout").
 *
 * The browser never sees a client-visible tenantId/userId — the session
 * token stays httpOnly-server-only by design (issue #42). This Server
 * Action runs server-side but has NO direct DB access (like every other
 * web→api path, it calls the API over HTTP); it resolves `(tenantId,
 * userId)` via the authenticated `GET /auth/identity` endpoint
 * (`fetchAuthIdentity`) and hashes them into an opaque, context-prefixed
 * key.
 *
 * Deliberately derived from `(tenantId, userId)`, NOT the session token:
 * the token is a random-entropy value that ROTATES on every login, so a
 * token-hash key would treat the SAME user's re-login as a brand-new
 * identity — `ensureIdentityScope` would then silently purge that user's
 * own unsynced queue as if it belonged to a different account (a confirmed
 * data-loss bug). Deriving from `(tenantId, userId)` instead is:
 *   - STABLE across logins/reloads for the same account (no more self-purge)
 *   - DISTINCT per account (cross-account queues stay isolated)
 *   - non-reversible and does not reuse any of the API's internal
 *     correlator keys (e.g. the session's `tokenHash`/`SessionId`) — the
 *     `"workout-offline:"` prefix scopes the hash to this one use case.
 *
 * Returns `undefined` when there is no session, or when the identity lookup
 * fails (expired/revoked session) — the offline module must not crash if it
 * does; callers degrade to the pre-offline direct-call behavior.
 */
export async function getOfflineIdentityKeyAction(): Promise<string | undefined> {
  const token = await sessionToken();
  if (!token) return undefined;

  const identity = await fetchAuthIdentity(token);
  if (identity.kind === "error") return undefined;

  return createHash("sha256")
    .update(`workout-offline:${identity.tenantId}:${identity.userId}`)
    .digest("hex");
}

export async function startWorkoutSessionAction(
  planId: string,
  day: number,
): Promise<StartWorkoutSessionActionResult> {
  const token = await sessionToken();
  const result = await startWorkoutSession(planId, day, token);

  if (result.kind === "ok") {
    return { kind: "ok", session: result.session };
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
