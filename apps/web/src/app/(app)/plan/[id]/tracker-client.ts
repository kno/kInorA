import "server-only";

import type { FlushErrorCode, WorkoutSessionRecord } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";
import type { WorkoutSetUpdateInput } from "./tracker-types";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type WorkoutSessionResult =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | {
      kind: "error";
      message: string;
      /**
       * Populated only on a 409 `active_session_conflict` (#93). Carries the
       * currently-active scope so the caller can render a banner instead of
       * crashing. Absent on every other error.
       */
      activePlanName?: string;
      activeDay?: number | null;
      /**
       * Discriminated flush-failure taxonomy (Phase 4 web offline).
       * Previously the HTTP status was resolved here and then discarded for
       * every case except 409 — `unwrapWorkoutSession` and the offline flush
       * handler need it preserved so retry (`UNREACHABLE`/`SERVER`) vs.
       * poison-drop (`VALIDATION`/`NOT_FOUND`) can be routed without
       * string-matching on `message`.
       */
      code?: FlushErrorCode;
    };

/**
 * Maps an HTTP status to the flush-failure taxonomy (Phase 4 web offline).
 *
 * 401/403 are split OUT of the generic 4xx→VALIDATION bucket: a session
 * that expired or was revoked (or a membership suspended) between enqueue
 * and flush is NOT a poison mutation — the mutation itself may be perfectly
 * valid. Bucketing it into VALIDATION would silently poison-drop the user's
 * work with zero feedback. AUTH stays queued (retryable) and the caller
 * surfaces a "session expired" notice instead.
 */
function flushErrorCodeFromStatus(status: number): FlushErrorCode {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "NOT_FOUND";
  if (status >= 400 && status < 500) return "VALIDATION";
  return "SERVER";
}

function requireSessionToken(
  token: string | undefined,
): { kind: "ok"; token: string } | { kind: "error"; message: string } {
  return token
    ? { kind: "ok", token }
    : { kind: "error", message: "no_session" };
}

function requestInit(
  method: "GET" | "POST" | "PATCH",
  token: string,
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(method === "GET" ? { cache: "no-store" } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function fetchWorkoutSessionRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  token: string,
  body: unknown | undefined,
  options: ClientOptions,
): Promise<Response> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  return fetchImpl(`${base}${path}`, requestInit(method, token, body));
}

async function parseWorkoutSessionResponse(
  res: Response,
): Promise<WorkoutSessionResult> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      activePlanName?: string;
      activeDay?: number | null;
    };
    // A 409 active_session_conflict carries the active scope; forward it so the
    // client can render the conflict banner. Other errors map to a bare message.
    if (res.status === 409 && payload.error === "active_session_conflict") {
      return {
        kind: "error",
        message: "active_session_conflict",
        activePlanName: payload.activePlanName,
        activeDay: payload.activeDay,
      };
    }
    return {
      kind: "error",
      message: payload.error ?? "workout_session_request_failed",
      code: flushErrorCodeFromStatus(res.status),
    };
  }

  const payload = (await res.json().catch(() => null)) as WorkoutSessionRecord | null;
  if (!payload?.id) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", session: payload };
}

async function performWorkoutSessionRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  token: string | undefined,
  body?: unknown,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  const tokenResult = requireSessionToken(token);
  if (tokenResult.kind === "error") return tokenResult;

  let res: Response;
  try {
    res = await fetchWorkoutSessionRequest(
      path,
      method,
      tokenResult.token,
      body,
      options,
    );
  } catch {
    return { kind: "error", message: "api_unreachable", code: "UNREACHABLE" };
  }

  return parseWorkoutSessionResponse(res);
}

export function startWorkoutSession(
  workoutPlanId: string,
  day: number,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return performWorkoutSessionRequest(
    "/workout-sessions",
    "POST",
    token,
    { workoutPlanId, day },
    options,
  );
}

export function fetchWorkoutSession(
  sessionId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return performWorkoutSessionRequest(
    `/workout-sessions/${sessionId}`,
    "GET",
    token,
    undefined,
    options,
  );
}

export function recordWorkoutSet(
  sessionId: string,
  setId: string,
  input: WorkoutSetUpdateInput,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return performWorkoutSessionRequest(
    `/workout-sessions/${sessionId}/sets/${setId}`,
    "PATCH",
    token,
    input,
    options,
  );
}

export function completeWorkoutSession(
  sessionId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return performWorkoutSessionRequest(
    `/workout-sessions/${sessionId}/complete`,
    "POST",
    token,
    {},
    options,
  );
}

export type AuthIdentityResult =
  | { kind: "ok"; tenantId: string; userId: string }
  | { kind: "error"; message: string };

/**
 * Calls `GET /auth/identity` to resolve the caller's `(tenantId, userId)`
 * (Phase 4 web offline — stable identity key derivation, see
 * `actions.ts#getOfflineIdentityKeyAction`).
 *
 * The web app never calls the DB directly; this is the one authenticated
 * round-trip that lets the Server Action derive a per-account identity key
 * that is STABLE across logins for the same user (unlike hashing the
 * session token, which rotates every login).
 */
export async function fetchAuthIdentity(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<AuthIdentityResult> {
  const tokenResult = requireSessionToken(token);
  if (tokenResult.kind === "error") return tokenResult;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/identity`, requestInit("GET", tokenResult.token));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    return { kind: "error", message: "auth_identity_request_failed" };
  }

  const payload = (await res.json().catch(() => null)) as
    | { tenantId?: string; userId?: string }
    | null;
  if (!payload?.tenantId || !payload.userId) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", tenantId: payload.tenantId, userId: payload.userId };
}
