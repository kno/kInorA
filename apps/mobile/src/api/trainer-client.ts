/**
 * Mobile trainer client-list / invite / create-plan-for-client API client
 * (15a-v2-trainer-account-access, Slice 5).
 *
 * Mirrors `plan-status-client.ts`'s conventions: the session token comes from
 * Expo SecureStore (`getSessionToken`) via a lazily-imported default (so this
 * module's graph stays unit-testable under vitest without pulling in
 * `expo-secure-store`), and the API base URL comes from
 * `process.env.API_BASE_URL`.
 *
 * Endpoints (wired in S3/S4 — see `apps/web/.../clients/trainer-client.ts`
 * for the same contract from the web side):
 *   GET  /trainer/clients                    → 200 ClientSummaryDTO[] | 403 (non-trainer/not entitled)
 *   POST /trainer/clients/invite              → 201 TrainerClientAssignmentDTO | 403 | 404 | 409
 *   POST /clients/:clientUserId/plan-specs    → 201 { id, spec, planId, status } | 403 | 409 | 422
 */

import type {
  ClientSummaryDTO,
  PlanGoal,
  PlanLimitation,
  TrainingLocation,
} from "@kinora/contracts";

async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function requestInit(method: "GET" | "POST", token: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

export type FetchClientsResult =
  | { kind: "ok"; clients: ClientSummaryDTO[] }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** Fetch the caller's assigned clients via `GET /trainer/clients`. */
export async function fetchClients(options: ClientOptions = {}): Promise<FetchClientsResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/trainer/clients`, requestInit("GET", token));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 403) return { kind: "forbidden" };

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_clients_failed" };
  }

  const body = (await res.json().catch(() => null)) as ClientSummaryDTO[] | null;
  if (!Array.isArray(body)) return { kind: "error", message: "invalid_response" };

  return { kind: "ok", clients: body };
}

export type InviteClientResult = { kind: "ok" } | { kind: "error"; message: string };

/** Invite a client by email via `POST /trainer/clients/invite`. */
export async function inviteClient(
  email: string,
  options: ClientOptions = {},
): Promise<InviteClientResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/trainer/clients/invite`, requestInit("POST", token, { email }));
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "invite_failed" };
  }

  return { kind: "ok" };
}

export interface CreatePlanForClientInput {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;
  equipment: string[];
  limitations: PlanLimitation[];
}

export type CreatePlanForClientResult =
  | { kind: "ok"; planId: string; status: string }
  | { kind: "error"; message: string };

/**
 * Create a confirmed plan spec + trigger generation for an assigned client via
 * `POST /clients/:clientUserId/plan-specs` (one-shot — no draft phase for
 * this path, mirrors the web app's `createPlanForClient`).
 */
export async function createPlanForClient(
  clientUserId: string,
  input: CreatePlanForClientInput,
  options: ClientOptions = {},
): Promise<CreatePlanForClientResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(
      `${base}/clients/${encodeURIComponent(clientUserId)}/plan-specs`,
      requestInit("POST", token, input),
    );
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
