import "server-only";

import type { TrainingLocation, UserPreferences } from "@kinora/contracts";

export interface UserPreferencesInput {
  defaultLocation: TrainingLocation | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
}

export type GetPreferencesResult =
  | { kind: "ok"; preferences: UserPreferences }
  | { kind: "error"; message: string };

export type SavePreferencesResult =
  | { kind: "ok"; preferences: UserPreferences }
  | { kind: "validation_error"; message: string }
  | { kind: "error"; message: string };

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isUserPreferences(body: unknown): body is UserPreferences {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.userId === "string" &&
    (value.defaultLocation === null || typeof value.defaultLocation === "string") &&
    (value.defaultDuration === null || typeof value.defaultDuration === "number") &&
    (value.defaultEquipment === null || isStringArray(value.defaultEquipment))
  );
}

export async function fetchUserPreferences(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<GetPreferencesResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-preferences`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isUserPreferences(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", preferences: body };
}

export async function updateUserPreferences(
  token: string | undefined,
  input: UserPreferencesInput,
  options: ClientOptions = {},
): Promise<SavePreferencesResult> {
  if (!token) return { kind: "error", message: "no_session" };

  if (
    input.defaultDuration !== null &&
    (input.defaultDuration <= 0 || !Number.isInteger(input.defaultDuration))
  ) {
    return { kind: "validation_error", message: "invalid_default_duration" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {};
  if (input.defaultLocation !== null) body.defaultLocation = input.defaultLocation;
  if (input.defaultDuration !== null) body.defaultDuration = input.defaultDuration;
  if (input.defaultEquipment !== null) body.defaultEquipment = input.defaultEquipment;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 422) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "validation_error", message: payload.error ?? "invalid_payload" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const responseBody = (await res.json().catch(() => null)) as unknown;
  if (!isUserPreferences(responseBody)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", preferences: responseBody };
}
