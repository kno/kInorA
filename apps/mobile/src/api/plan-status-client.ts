/**
 * Mobile plan-status + regenerate/adapt API client
 * (Track C1 of 14a-v1.1-adaptation-adherence — the RN plan/regenerate
 * foundation the create-plan chat never needed).
 *
 * Mirrors the web app's `create-plan/plan-draft-client.ts` (`fetchPlanStatus` /
 * `regeneratePlan` / `adaptPlan`, same REST endpoints, same result-mapping) and
 * the mobile `plan-draft-client.ts`'s runtime adaptation:
 *   - the session token comes from Expo SecureStore (`getSessionToken`), not a
 *     cookie — mobile calls the API DIRECTLY and already holds the Bearer token;
 *   - the API base URL comes from `process.env.API_BASE_URL`, matching the
 *     convention already used by `plan-draft-client.ts` / `workout-session.ts`.
 *
 * DTOs are imported from `@kinora/contracts` — no local redefinition of the
 * shared shapes (`DashboardSummaryDTO`, `WorkoutProgram`,
 * `AdaptationRecommendation`).
 *
 * Tenant scoping: identity is resolved server-side from the Bearer token only.
 * This client NEVER puts a tenantId/userId/daysPerWeek in any request body
 * (asserted in the test suite). The confirm endpoints are SERVER-AUTHORITATIVE:
 *   - `POST /plan-specs/:id/regenerate` re-reads `spec_json` and never trusts a body;
 *   - `POST /plan-specs/:id/adapt` re-derives the reduced `daysPerWeek` itself,
 *     so a caller can never forge an arbitrary frequency. Both post `{}`.
 *
 * Endpoints:
 *   GET  /workout-plans/:id             → 200 { id, status, program?, specId?, name? } | 404
 *   GET  /plan-specs/:id/workout-plan   → 200 (latest plan for a spec) | 404
 *   POST /plan-specs/:id/regenerate {}  → 202 { planId, status } | 403 (quota) | 404
 *   POST /plan-specs/:id/adapt      {}  → 202 { planId, status } | 409 no_adaptation | 403 (quota) | 404
 *   GET  /progress/dashboard            → 200 DashboardSummaryDTO (incl. optional `adaptation`)
 */

import type { DashboardSummaryDTO, WorkoutProgram } from "@kinora/contracts";

/**
 * Default token source. Imported lazily so this module's graph does not pull in
 * `expo-secure-store` (and, transitively, React Native's Flow-typed entry) at
 * import time — that keeps the client unit-testable under vitest, where a
 * `getToken` override is always injected. Mirrors `plan-draft-client.ts`.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

/**
 * Narrow fetch shape this client actually uses (URL string + init). Decoupled
 * from the ambient `typeof fetch` so it does not depend on which fetch lib
 * (React Native's `RequestInfo` overload vs the DOM `URL` overload) is in
 * scope — the global `fetch` remains assignable to it. Mirrors
 * `plan-draft-client.ts` / `workout-session.ts`.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  /** Override the token source (defaults to SecureStore) — for tests. */
  getToken?: () => Promise<string | null>;
}

/**
 * Typed failure shape shared by every client call.
 *
 * `sessionExpired` is the single re-auth/logout signal the caller (the C2
 * plan-status screen / the D banner) reacts to by clearing the stored token and
 * routing to Login, mirroring `WorkoutTrackerScreen`'s AUTH handling. It is set
 * on BOTH a `401` and a missing stored token (no session at all) — in either
 * case there is no usable session, so the screen should re-auth. A `403`
 * (quota exhausted) or `409` (`no_adaptation`) is NOT a session-expiry signal
 * and never sets it; those carry `status` so the caller can branch (e.g. map a
 * 403 to an "upgrade" affordance, a 409 to "already up to date") without
 * string-matching on `message`. `status` is absent on client-local failures
 * (`no_session`, `api_unreachable`, `invalid_response`, `no_plan_id`).
 */
export interface PlanStatusError {
  kind: "error";
  /** Machine-readable key: the server's `error` key, or a client-local code. */
  message: string;
  /** HTTP status of a server error (401/403/404/409/...); absent on client-local errors. */
  status?: number;
  /** Set on a 401 OR a missing token — the caller re-authenticates. */
  sessionExpired?: true;
}

/** A workout plan's current status (the client DTO the API returns, not the DB row). */
export interface PlanStatus {
  id: string;
  /** "generating" | "ready" | "failed" (kept wide — the server owns the vocabulary). */
  status: string;
  /** Present once the plan is `ready`. */
  program?: WorkoutProgram;
  /** The spec this plan was generated from (used to regenerate/adapt). */
  specId?: string;
  /** Resolved plan label (server applies the blank→default rule). */
  name?: string;
}

export type FetchPlanStatusResult =
  | { kind: "ok"; plan: PlanStatus }
  | PlanStatusError;

/**
 * Result of a regenerate/adapt confirm: `202 { planId, status }` on success, or
 * a typed error. `adaptPlan`'s `409` (`no_adaptation`) and both endpoints' `403`
 * (quota exhausted) surface as `{ kind: "error", status, message }`.
 */
export type GenerateResult =
  | { kind: "ok"; planId: string; status: string }
  | PlanStatusError;

export type FetchDashboardResult =
  | { kind: "ok"; summary: DashboardSummaryDTO }
  | PlanStatusError;

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function requestInit(
  method: "GET" | "POST",
  token: string,
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** The no-session sentinel — no token means no usable session → re-auth. */
const NO_SESSION: PlanStatusError = {
  kind: "error",
  message: "no_session",
  sessionExpired: true,
};

/**
 * Map a non-ok `Response` to a typed `PlanStatusError`, reading the server's
 * machine-readable `error` key when present and always carrying the HTTP
 * `status` so the caller can branch (403 quota vs 404 vs 409 no_adaptation). A
 * `401` additionally raises the `sessionExpired` re-auth signal.
 */
async function mapError(res: Response, fallback: string): Promise<PlanStatusError> {
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  const error: PlanStatusError = {
    kind: "error",
    message: payload.error ?? fallback,
    status: res.status,
  };
  if (res.status === 401) {
    error.sessionExpired = true;
  }
  return error;
}

/** Shared GET helper for a plan-status read (`/workout-plans/:id` or `/plan-specs/:id/workout-plan`). */
async function fetchPlan(
  path: string,
  fallback: string,
  options: ClientOptions,
): Promise<FetchPlanStatusResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return NO_SESSION;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, requestInit("GET", token));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, fallback);

  const body = (await res.json().catch(() => null)) as PlanStatus | null;
  if (!body || typeof body.id !== "string") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", plan: body };
}

/**
 * Fetch the current status of a workout plan via `GET /workout-plans/:planId`.
 * Used by the C2 screen to poll a `generating → ready` transition. A `404`
 * (unknown/cross-tenant plan) maps to an error carrying `status: 404`.
 */
export function fetchPlanStatus(
  planId: string,
  options: ClientOptions = {},
): Promise<FetchPlanStatusResult> {
  return fetchPlan(`/workout-plans/${planId}`, "fetch_plan_failed", options);
}

/**
 * Fetch the LATEST plan generated for a spec via
 * `GET /plan-specs/:specId/workout-plan`. Lets the C2/C3 entry point resolve
 * "what's the current plan for this spec?" without knowing the planId up front.
 */
export function fetchLatestPlanForSpec(
  specId: string,
  options: ClientOptions = {},
): Promise<FetchPlanStatusResult> {
  return fetchPlan(
    `/plan-specs/${specId}/workout-plan`,
    "fetch_plan_failed",
    options,
  );
}

/** Shared POST helper for the regenerate/adapt confirm endpoints (both send `{}`). */
async function postGeneration(
  path: string,
  fallback: string,
  options: ClientOptions,
): Promise<GenerateResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return NO_SESSION;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, requestInit("POST", token, {}));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, fallback);

  const body = (await res.json().catch(() => ({}))) as {
    planId?: string;
    status?: string;
  };
  if (!body.planId) return { kind: "error", message: "no_plan_id" };
  return { kind: "ok", planId: body.planId, status: body.status ?? "generating" };
}

/**
 * Regenerate a confirmed plan via `POST /plan-specs/:specId/regenerate` → `202
 * { planId, status: "generating" }`. Server-authoritative (re-reads `spec_json`).
 * `403` (quota exhausted) and `404` (unknown/cross-tenant spec) map to a typed
 * error carrying the `status`.
 */
export function regeneratePlan(
  specId: string,
  options: ClientOptions = {},
): Promise<GenerateResult> {
  return postGeneration(
    `/plan-specs/${specId}/regenerate`,
    "regenerate_failed",
    options,
  );
}

/**
 * Confirm an adherence adaptation via `POST /plan-specs/:specId/adapt` → `202
 * { planId, status }`. The body is `{}` — the server re-derives the reduced
 * `daysPerWeek` and ignores any client-supplied frequency. A `409`
 * (`no_adaptation`, the recommendation went stale/recovered) or `403` (quota
 * exhausted) maps to a typed error carrying the `status` so the banner can show
 * it inline with the plan unchanged.
 */
export function adaptPlan(
  specId: string,
  options: ClientOptions = {},
): Promise<GenerateResult> {
  return postGeneration(`/plan-specs/${specId}/adapt`, "adapt_failed", options);
}

/**
 * Fetch the dashboard summary via `GET /progress/dashboard`. Carries the
 * optional `adaptation` recommendation (14a) the D banner renders when
 * `adaptation.level === "low"`. This read consumes NO billing quota (server
 * property) and is available to all tiers.
 */
export async function fetchDashboardSummary(
  options: ClientOptions = {},
): Promise<FetchDashboardResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return NO_SESSION;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/progress/dashboard`, requestInit("GET", token));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, "fetch_dashboard_failed");

  const body = (await res.json().catch(() => null)) as DashboardSummaryDTO | null;
  if (!body || typeof body.streak !== "number") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", summary: body };
}
