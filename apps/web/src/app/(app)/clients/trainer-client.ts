import "server-only";

/**
 * Trainer client-list / invite / create-plan-for-client API client
 * (15a-v2-trainer-account-access, Slice 5).
 *
 * Mirrors `dashboard-client.ts` / `plan-draft-client.ts`: pure orchestration
 * over `fetch`, unit-testable without any Next.js framework import. The
 * Server Actions in `actions.ts` wrap these calls with the session cookie.
 *
 * Endpoints (wired in S3/S4):
 *   GET  /trainer/clients                    → 200 ClientSummaryDTO[] | 403 (non-trainer/not entitled)
 *   POST /trainer/clients/invite              → 201 TrainerClientAssignmentDTO | 403 | 404 | 409
 *   POST /clients/:clientUserId/plan-specs    → 201 { id, spec, planId, status } | 403 | 409 | 422
 *   GET  /clients/:clientUserId/workout-plans/:planId → 200 ClientPlanDetail | 403 | 404 (#341)
 *
 * A `403` on `fetchClients` is the ONLY signal the web app has that the
 * caller is not an entitled trainer (no `role`/`tier` is exposed to the web
 * app today — see the S5 apply-progress deviation note). The `/clients` page
 * treats it as "not a trainer" and renders an access-restricted state instead
 * of the list.
 */
import type { ClientSummaryDTO } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";
import type {
  ClientPlanDetail,
  CreatePlanForClientInput,
  CreatePlanForClientResult,
  FetchClientPlanResult,
  FetchClientsResult,
  InviteClientResult,
} from "./trainer-client-types";

export type {
  ClientPlanDetail,
  CreatePlanForClientInput,
  CreatePlanForClientResult,
  FetchClientPlanResult,
  FetchClientsResult,
  InviteClientResult,
} from "./trainer-client-types";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

/** Fetch the caller's assigned clients via `GET /trainer/clients`. */
export async function fetchClients(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchClientsResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/trainer/clients`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 403) {
    return { kind: "forbidden" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_clients_failed" };
  }

  const body = (await res.json().catch(() => null)) as ClientSummaryDTO[] | null;
  if (!Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", clients: body };
}

/** Invite a client by email via `POST /trainer/clients/invite`. */
export async function inviteClient(
  token: string | undefined,
  email: string,
  options: ClientOptions = {},
): Promise<InviteClientResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/trainer/clients/invite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "invite_failed" };
  }

  return { kind: "ok" };
}

/**
 * Create a confirmed plan spec + trigger generation for an assigned client via
 * `POST /clients/:clientUserId/plan-specs` (one-shot — no draft phase for this
 * path, mirrors `promotePlanSpec` + `confirmPlanGen` combined into a single
 * request server-side).
 */
export async function createPlanForClient(
  clientUserId: string,
  input: CreatePlanForClientInput,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<CreatePlanForClientResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/clients/${encodeURIComponent(clientUserId)}/plan-specs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "create_plan_for_client_failed" };
  }

  const body = (await res.json().catch(() => ({}))) as { planId?: string; status?: string };
  if (!body.planId || !body.status) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", planId: body.planId, status: body.status };
}

/**
 * Read an assigned client's plan detail via
 * `GET /clients/:clientUserId/workout-plans/:planId` (#341).
 *
 * The trainer CANNOT use `GET /workout-plans/:planId` for this: that read is
 * hard-scoped to the caller's own `(tenantId, userId)`, so a client-owned plan
 * 404s there. Authorization lives entirely server-side (`resolveAuthorizedOwner`
 * — role + trainer entitlement + ACTIVE assignment); this function only maps the
 * outcome, and treats anything other than an explicit 403/404 as a generic
 * error so a new API status can never be read as success.
 */
export async function fetchClientPlan(
  clientUserId: string,
  planId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchClientPlanResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(
      `${base}/clients/${encodeURIComponent(clientUserId)}/workout-plans/${encodeURIComponent(planId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 403) {
    return { kind: "forbidden" };
  }

  if (res.status === 404) {
    return { kind: "notFound" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_client_plan_failed" };
  }

  const body = (await res.json().catch(() => null)) as ClientPlanDetail | null;
  if (!body?.id) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", plan: body };
}
