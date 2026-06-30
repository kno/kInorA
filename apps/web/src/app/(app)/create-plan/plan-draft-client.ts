import "server-only";

/**
 * Pure orchestration for the create-plan draft + promote API calls.
 *
 * Extracted from the Next.js Server Actions so the API-call + result-mapping
 * logic is unit-testable with a mock `fetch` (no Next framework imports). The
 * Server Actions in `actions.ts` wrap these: they read the `kinora_session`
 * cookie for the Bearer token and pass it in, then redirect on promote.
 *
 * Mirrors the `submitLogin` pattern (login/submit-login.ts).
 *
 * The client sends the raw wizard input to the API. preferenceScores and
 * confirmed are derived server-side on promote — the client never computes them.
 *
 * This module is server-only: it reads process.env.API_BASE_URL (the internal
 * Docker address http://api:4000) which only resolves from within the Docker
 * network. Client components must call a server action instead.
 */
import type { PlanSpec } from "@kinora/contracts";

/** True when every required PlanSpec field is present (equipment/limitations may be empty). */
export function isSpecComplete(spec: Partial<PlanSpec>): boolean {
  return (
    spec.goal != null &&
    spec.location != null &&
    spec.daysPerWeek != null &&
    spec.sessionDurationMinutes != null &&
    spec.equipment != null &&
    spec.limitations != null
  );
}

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export interface CurrentDraft {
  step: number;
  spec: Partial<PlanSpec>;
}

export type DraftSubmitResult =
  | { kind: "ok" }
  | { kind: "error"; message: string };

export type PromoteResult =
  | { kind: "ok"; id: string }
  | { kind: "error"; message: string };

export type ConfirmResult =
  | { kind: "ok"; planId: string; status: string }
  | { kind: "error"; message: string };

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

/**
 * Load the current server draft via `GET /plan-specs/drafts/current`.
 * Returns `null` when there is no session, no draft (`204`), or on any error
 * — the wizard then starts fresh at step 1.
 */
export async function loadCurrentDraft(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<CurrentDraft | null> {
  if (!token) return null;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/drafts/current`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (res.status === 204 || !res.ok) {
    return null;
  }

  const body = (await res.json().catch(() => null)) as CurrentDraft | null;
  if (!body || typeof body.step !== "number") {
    return null;
  }
  return { step: body.step, spec: body.spec ?? {} };
}

/**
 * Upsert the current draft via `POST /plan-specs/drafts`.
 * The token is the opaque session bearer read from the `kinora_session` cookie.
 */
export async function submitDraft(
  step: number,
  spec: Partial<PlanSpec>,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<DraftSubmitResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/drafts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ step, spec }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "draft_save_failed" };
  }

  return { kind: "ok" };
}

/**
 * Confirm a promoted PlanSpec and trigger AI plan generation.
 * Calls `POST /plan-specs/:specId/confirm` → `{ planId, status: "generating" }`.
 * Returns the planId so the caller can navigate to the plan status view.
 */
export async function confirmPlanGen(
  specId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ConfirmResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/${specId}/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "confirm_failed" };
  }

  const body = (await res.json().catch(() => ({}))) as {
    planId?: string;
    status?: string;
  };
  if (!body.planId) {
    return { kind: "error", message: "no_plan_id" };
  }

  return { kind: "ok", planId: body.planId, status: body.status ?? "generating" };
}

/**
 * Trigger plan regeneration via `POST /plan-specs/:specId/regenerate`.
 * Returns `{ planId, status: "generating" }` so the caller can set UI status.
 */
export type RegenerateResult =
  | { kind: "ok"; planId: string; status: string }
  | { kind: "error"; message: string };

export async function regeneratePlan(
  specId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<RegenerateResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/${specId}/regenerate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "regenerate_failed" };
  }

  const body = (await res.json().catch(() => ({}))) as {
    planId?: string;
    status?: string;
  };
  if (!body.planId) {
    return { kind: "error", message: "no_plan_id" };
  }

  return { kind: "ok", planId: body.planId, status: body.status ?? "generating" };
}

/**
 * Fetch the current status of a workout plan via `GET /workout-plans/:planId`.
 */
export interface PlanStatusResponse {
  id: string;
  status: string;
  program?: unknown;
  specId?: string;
}

export type FetchPlanResult =
  | { kind: "ok"; plan: PlanStatusResponse }
  | { kind: "error"; message: string };

export async function fetchPlanStatus(
  planId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchPlanResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/workout-plans/${planId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_plan_failed" };
  }

  const body = (await res.json().catch(() => null)) as PlanStatusResponse | null;
  if (!body?.id) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", plan: body };
}

/**
 * Lightweight summary of a workout plan for the plan selector.
 */
export interface PlanSummary {
  id: string;
  status: string;
  createdAt: string;
}

export type FetchUserPlansResult =
  | { kind: "ok"; plans: PlanSummary[] }
  | { kind: "error"; message: string };

/**
 * Fetch all plans for the authenticated user via `GET /workout-plans`.
 * Returns summaries newest-first. On any error returns { kind: "error" }.
 * Only usable server-side (this module imports server-only).
 */
export async function fetchUserPlans(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchUserPlansResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/workout-plans`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_plans_failed" };
  }

  const body = (await res.json().catch(() => null)) as PlanSummary[] | null;
  if (!Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", plans: body };
}

/**
 * Promote the current draft to a confirmed `PlanSpec` via `POST /plan-specs`.
 * Returns the new spec id on success; a `409` maps to an error result so the
 * UI can keep the user on the wizard.
 */
export async function promotePlanSpec(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<PromoteResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "promote_failed" };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return { kind: "error", message: "no_spec_id" };
  }

  return { kind: "ok", id: body.id };
}
