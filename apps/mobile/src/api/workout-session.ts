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

import type {
  AutoClosedSessionNotice,
  FlushErrorCode,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutSessionRecord,
} from "@kinora/contracts";

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
  | {
      kind: "ok";
      session: WorkoutSessionRecord;
      /**
       * 17b: additive sibling key present only when this start auto-closed a
       * stale (>24h) session. Absent on record/complete/abandon responses.
       */
      autoClosedSession?: AutoClosedSessionNotice;
    }
  | {
      kind: "error";
      /** Machine-readable key; `active_session_conflict` on a 409. */
      message: string;
      /** Populated only on a 409 conflict, mirroring the web client. */
      activePlanName?: string;
      activeDay?: number | null;
      /**
       * 17b scope A: the blocking session's id and start date, so the caller
       * can offer Resume (navigate to its tracker) and name the date in the
       * banner. Populated only alongside `active_session_conflict`.
       */
      activeSessionId?: string;
      activeStartedAt?: string;
      /**
       * 17d (kno/kInorA#409): the days that DO exist in the plan, carried by
       * the API's `404 day_not_in_plan` refusal. Populated only alongside
       * `day_not_in_plan` — the requested day was removed from the plan (the
       * web plan editor can do that), so the screen names the days that
       * remain instead of collapsing the refusal into a generic failure.
       *
       * An empty array is a legitimate value (a plan with no days left), and
       * is deliberately distinct from `undefined` (this is not that refusal).
       */
      availableDays?: number[];
      /**
       * Discriminated flush-failure taxonomy (Phase 5 mobile offline,
       * 09b-v1 design "Error discrimination through the Server Actions /
       * API client boundary"). Previously this client held the HTTP status
       * internally but discarded it for every case except 409 — the
       * offline flush handler needs `code` to route retry (`UNREACHABLE`/
       * `SERVER`), poison-drop (`VALIDATION`/`NOT_FOUND`), and auth
       * (`AUTH`) decisions without string-matching on `message`.
       *
       * Absent on the 409 `active_session_conflict` branch (that shape is
       * a structural start-conflict, not a flush-taxonomy failure) and on
       * `no_session`/`invalid_response` (client-local failures, never
       * routed through the flush taxonomy). `STALE_ACTION` never appears
       * here — mobile calls the API directly (no Next.js Server Actions),
       * so that web-only failure mode does not apply.
       */
      code?: FlushErrorCode;
    };

/**
 * Maps an HTTP status (for any non-409, non-ok response) to a
 * `FlushErrorCode`, mirroring web's `flushErrorCodeFromStatus`:
 *   401/403 → AUTH (retryable, entry stays queued, never poison-dropped —
 *     the session went stale, not necessarily the mutation itself)
 *   404 → NOT_FOUND (poison — drop + surface)
 *   other 4xx (400/422/...) → VALIDATION (poison — drop + surface)
 *   5xx / anything else → SERVER (retryable, treated like UNREACHABLE)
 */
function flushErrorCodeFromStatus(status: number): FlushErrorCode {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "NOT_FOUND";
  if (status >= 400 && status < 500) return "VALIDATION";
  return "SERVER";
}

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
      activeSessionId?: string;
      activeStartedAt?: string;
      availableDays?: unknown;
    };
    if (res.status === 409 && payload.error === "active_session_conflict") {
      return {
        kind: "error",
        message: "active_session_conflict",
        activePlanName: payload.activePlanName,
        activeDay: payload.activeDay ?? null,
        activeSessionId: payload.activeSessionId,
        activeStartedAt: payload.activeStartedAt,
      };
    }
    // 17d (kno/kInorA#409): `404 day_not_in_plan` carries `availableDays`.
    // The generic mapping below flattens an error response to `message` +
    // `code` and drops every sibling field, so without this branch the days
    // the API deliberately sends never reach the screen.
    if (res.status === 404 && payload.error === "day_not_in_plan") {
      return {
        kind: "error",
        message: "day_not_in_plan",
        availableDays: Array.isArray(payload.availableDays)
          ? payload.availableDays.filter(
              (candidate): candidate is number => typeof candidate === "number",
            )
          : [],
        code: flushErrorCodeFromStatus(res.status),
      };
    }
    return {
      kind: "error",
      message: payload.error ?? "workout_session_request_failed",
      code: flushErrorCodeFromStatus(res.status),
    };
  }

  const payload = (await res
    .json()
    .catch(() => null)) as
    | (WorkoutSessionRecord & { autoClosedSession?: AutoClosedSessionNotice })
    | null;
  if (!payload?.id) {
    return { kind: "error", message: "invalid_response" };
  }
  return {
    kind: "ok",
    session: payload,
    ...(payload.autoClosedSession ? { autoClosedSession: payload.autoClosedSession } : {}),
  };
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
    return { kind: "error", message: "api_unreachable", code: "UNREACHABLE" };
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

/**
 * POST /workout-sessions/:id/abandon (17b scope A Discard). Reuses the same
 * write path threshold-based auto-close uses — this is the client trigger,
 * never a second mechanism. A 409 here is `session_not_active` (the session
 * already completed), NOT `active_session_conflict`, so it falls through to
 * the generic error mapping.
 */
export function abandonSession(
  sessionId: string,
  options: ClientOptions = {},
): Promise<WorkoutSessionResult> {
  return request(
    `/workout-sessions/${sessionId}/abandon`,
    "POST",
    {},
    options,
  );
}

export type FetchHistoryResult =
  | { kind: "ok"; entries: WorkoutHistoryEntry[] }
  | { kind: "error"; message: string };

function historyPath(query: WorkoutHistoryQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));

  const search = params.toString();
  return search ? `/workout-sessions/history?${search}` : "/workout-sessions/history";
}

/**
 * Fetch a page of completed-session history via `GET /workout-sessions/history`
 * (#09b Session History — sync-independent, never touches the offline
 * mutation queue or session snapshot cache).
 */
export async function getWorkoutHistory(
  query: WorkoutHistoryQuery,
  options: ClientOptions = {},
): Promise<FetchHistoryResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}${historyPath(query)}`, requestInit("GET", token));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_history_failed" };
  }

  const body = (await res.json().catch(() => null)) as WorkoutHistoryEntry[] | null;
  if (!Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", entries: body };
}
