import "server-only";

import type { WorkoutSessionRecord } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";
import type { WorkoutSetUpdateInput } from "./tracker-types";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type WorkoutSessionResult =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | { kind: "error"; message: string };

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
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      kind: "error",
      message: payload.error ?? "workout_session_request_failed",
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
    return { kind: "error", message: "api_unreachable" };
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
