/**
 * Mobile workout-session API client.
 *
 * Mirrors the web app's `tracker-client.ts` (same REST endpoints, same
 * `Bearer` auth, same 409 `active_session_conflict` handling) but is adapted
 * to the mobile runtime:
 *   - the session token comes from Expo SecureStore (`getSessionToken`), not
 *     a cookie;
 *   - the API base URL comes from `process.env.API_BASE_URL`, matching the
 *     convention already used by LoginScreen / callback-proxy.
 *
 * DTOs are imported from `@kinora/contracts` — no local redefinition.
 *
 * Endpoints:
 *   POST   /workout-sessions                       { workoutPlanId, day }
 *   GET    /workout-sessions/:id
 *   PATCH  /workout-sessions/:id/sets/:setId        WorkoutSetUpdateInput
 *   POST   /workout-sessions/:id/complete           {}
 */

import type { WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Default token source. Imported lazily so this module's graph does not pull
 * in `expo-secure-store` (and, transitively, React Native's Flow-typed entry)
 * at import time — that keeps the client unit-testable under vitest, where a
 * `getToken` override is always injected.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

/** Input shape for recording a set (kept local — web keeps it in tracker-types). */
export interface WorkoutSetUpdateInput {
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

export type WorkoutSessionResult =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | {
      kind: "error";
      /** Machine-readable key; `active_session_conflict` on a 409. */
      message: string;
      /** Populated only on a 409 conflict, mirroring the web client. */
      activePlanName?: string;
      activeDay?: number | null;
    };

/**
 * Narrow fetch shape this client actually uses (URL string + init). Decoupled
 * from the ambient `typeof fetch` so it does not depend on which fetch lib
 * (React Native's `RequestInfo` overload vs the DOM `URL` overload) is in
 * scope — the global `fetch` remains assignable to it.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  /** Override the token source (defaults to SecureStore) — for tests. */
  getToken?: () => Promise<string | null>;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
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
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function parseResponse(res: Response): Promise<WorkoutSessionResult> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      activePlanName?: string;
      activeDay?: number | null;
    };
    if (res.status === 409 && payload.error === "active_session_conflict") {
      return {
        kind: "error",
        message: "active_session_conflict",
        activePlanName: payload.activePlanName,
        activeDay: payload.activeDay ?? null,
      };
    }
    return {
      kind: "error",
      message: payload.error ?? "workout_session_request_failed",
    };
  }

  const payload = (await res
    .json()
    .catch(() => null)) as WorkoutSessionRecord | null;
  if (!payload?.id) {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", session: payload };
}

async function request(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body: unknown | undefined,
  options: ClientOptions,
): Promise<WorkoutSessionResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, requestInit(method, token, body));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
  return parseResponse(res);
}

export function startWorkoutSession(
  workoutPlanId: string,
  day: number,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return request(
    "/workout-sessions",
    "POST",
    { workoutPlanId, day },
    options,
  );
}

export function getWorkoutSession(
  sessionId: string,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return request(`/workout-sessions/${sessionId}`, "GET", undefined, options);
}

export function recordWorkoutSet(
  sessionId: string,
  setId: string,
  input: WorkoutSetUpdateInput,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return request(
    `/workout-sessions/${sessionId}/sets/${setId}`,
    "PATCH",
    input,
    options,
  );
}

export function completeWorkoutSession(
  sessionId: string,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return request(
    `/workout-sessions/${sessionId}/complete`,
    "POST",
    {},
    options,
  );
}
