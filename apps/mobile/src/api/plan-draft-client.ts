/**
 * Mobile plan-draft API client (Track C1 of item-13, the RN create-plan chat
 * foundation).
 *
 * Mirrors the web app's `create-plan/plan-draft-client.ts` (same REST
 * endpoints, same result-mapping) but is adapted to the mobile runtime:
 *   - the session token comes from Expo SecureStore (`getSessionToken`), not
 *     the `kinora_session` httpOnly cookie — mobile calls the API DIRECTLY and
 *     already holds the Bearer token;
 *   - the API base URL comes from `process.env.API_BASE_URL`, matching the
 *     convention already used by `workout-session.ts` / `auth-identity.ts`.
 *
 * DTOs are imported from `@kinora/contracts` — no local redefinition. The draft
 * spec is a `PlanSpecDraft` (all wizard-input fields optional); the API derives
 * `preferenceScores`/`confirmed` server-side on promote, so this client never
 * sends them.
 *
 * Tenant scoping: identity is resolved server-side from the Bearer token only.
 * This client NEVER puts a tenantId/userId in any request body (asserted in the
 * test suite) — a caller-supplied tenant id could not change the server's
 * authenticated scope anyway, so we never send one.
 *
 * Endpoints:
 *   GET  /plan-specs/drafts/current   → 200 { step, spec } | 204 (no draft)
 *   POST /plan-specs/drafts           { step, spec } → 200 { step, spec }
 *   POST /plan-specs                  {} → 201 { id, spec }   (server-authoritative)
 *   POST /plan-specs/:id/confirm      {} → 200 { planId, status }
 */

import type { PlanSpecDraft } from "@kinora/contracts";

/**
 * Default token source. Imported lazily so this module's graph does not pull
 * in `expo-secure-store` (and, transitively, React Native's Flow-typed entry)
 * at import time — that keeps the client unit-testable under vitest, where a
 * `getToken` override is always injected. Mirrors `workout-session.ts`.
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
 * `workout-session.ts`.
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

/** A current draft: the wizard step plus the partial spec captured so far. */
export interface CurrentDraft {
  step: number;
  spec: PlanSpecDraft;
}

/**
 * Typed failure shape shared by every client call.
 *
 * `sessionExpired` is set ONLY on a `401` — it is the re-auth/logout signal the
 * caller (the C2b Asistente screen) reacts to by clearing the stored token and
 * routing to Login, mirroring `WorkoutTrackerScreen`'s AUTH handling. A `403`
 * (e.g. `premium_required`) is NOT a session-expiry signal and never sets it.
 */
export interface DraftError {
  kind: "error";
  message: string;
  sessionExpired?: true;
}

export type GetDraftResult =
  | { kind: "ok"; draft: CurrentDraft }
  | { kind: "empty" }
  | DraftError;

export type SaveDraftResult = { kind: "ok"; draft: CurrentDraft } | DraftError;

export type PromoteResult = { kind: "ok"; id: string } | DraftError;

export type ConfirmResult =
  | { kind: "ok"; planId: string; status: string }
  | DraftError;

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

/**
 * Map a non-ok `Response` to a typed `DraftError`, reading the server's
 * machine-readable `error` key when present. A `401` additionally raises the
 * `sessionExpired` re-auth signal.
 */
async function mapError(res: Response, fallback: string): Promise<DraftError> {
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  const error: DraftError = { kind: "error", message: payload.error ?? fallback };
  if (res.status === 401) {
    error.sessionExpired = true;
  }
  return error;
}

/**
 * Load the current server draft via `GET /plan-specs/drafts/current`.
 *   - no stored token          → `{ kind: "error", message: "no_session" }`
 *   - `204` (no current draft) → `{ kind: "empty" }`
 *   - `200`                    → `{ kind: "ok", draft }`
 */
export async function getCurrentDraft(
  options: ClientOptions = {},
): Promise<GetDraftResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(
      `${base}/plan-specs/drafts/current`,
      requestInit("GET", token),
    );
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 204) return { kind: "empty" };
  if (!res.ok) return mapError(res, "fetch_draft_failed");

  const body = (await res.json().catch(() => null)) as CurrentDraft | null;
  if (!body || typeof body.step !== "number") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", draft: { step: body.step, spec: body.spec ?? {} } };
}

/**
 * Upsert the current draft via `POST /plan-specs/drafts`.
 * Sends the raw wizard input (step + partial spec) only — the server derives
 * `preferenceScores`/`confirmed` on promote.
 */
export async function saveDraft(
  step: number,
  spec: PlanSpecDraft,
  options: ClientOptions = {},
): Promise<SaveDraftResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(
      `${base}/plan-specs/drafts`,
      requestInit("POST", token, { step, spec }),
    );
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, "draft_save_failed");

  const body = (await res.json().catch(() => null)) as CurrentDraft | null;
  if (!body || typeof body.step !== "number") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", draft: { step: body.step, spec: body.spec ?? {} } };
}

/**
 * Promote the current draft to a confirmed `PlanSpec` via `POST /plan-specs`.
 *
 * This endpoint is SERVER-AUTHORITATIVE: it reads the caller's stored draft and
 * derives the confirmed spec server-side, ignoring the request body (mirrors
 * web's `promotePlanSpec`, which posts `{}`). There is intentionally no `spec`
 * parameter — passing one client-side could not change what the server
 * promotes. A `409` maps to a typed error (`no_active_draft`/`incomplete_spec`)
 * so the caller can keep the user in the chat/wizard.
 */
export async function promoteDraft(
  options: ClientOptions = {},
): Promise<PromoteResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs`, requestInit("POST", token, {}));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, "promote_failed");

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return { kind: "error", message: "no_spec_id" };
  return { kind: "ok", id: body.id };
}

/**
 * Confirm a promoted `PlanSpec` and trigger AI plan generation via
 * `POST /plan-specs/:specId/confirm` → `{ planId, status: "generating" }`.
 * Returns the planId so the caller can navigate to the plan status view.
 */
export async function confirmPlan(
  specId: string,
  options: ClientOptions = {},
): Promise<ConfirmResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(
      `${base}/plan-specs/${specId}/confirm`,
      requestInit("POST", token, {}),
    );
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) return mapError(res, "confirm_failed");

  const body = (await res.json().catch(() => ({}))) as {
    planId?: string;
    status?: string;
  };
  if (!body.planId) return { kind: "error", message: "no_plan_id" };
  return { kind: "ok", planId: body.planId, status: body.status ?? "generating" };
}
