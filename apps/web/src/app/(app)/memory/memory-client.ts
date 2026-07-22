import "server-only";

import type {
  CreateUserMemoryRequest,
  CreateUserMemoryResponse,
  DeleteUserMemoryResponse,
  ListUserMemoriesResponse,
  MemorySettings,
  UpdateMemorySettingsRequest,
  UserMemory,
} from "@kinora/contracts";

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export type ListUserMemoriesResult =
  | { kind: "ok"; data: ListUserMemoriesResponse }
  | { kind: "error"; message: string };

export type CreateUserMemoryResult =
  | { kind: "ok"; data: CreateUserMemoryResponse }
  | { kind: "validation_error"; message: string }
  | { kind: "error"; message: string };

export type DeleteUserMemoryResult =
  | { kind: "ok"; data: DeleteUserMemoryResponse }
  | { kind: "error"; message: string };

export type UpdateMemorySettingsResult =
  | { kind: "ok"; data: MemorySettings }
  | { kind: "error"; message: string };

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function headers(token: string | undefined, json = false): HeadersInit {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function isMemorySettings(value: unknown): value is MemorySettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenantId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.settingsVersion === "number" &&
    typeof candidate.updatedAt === "string"
  );
}

function isUserMemory(value: unknown): value is UserMemory {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isListUserMemoriesResponse(value: unknown): value is ListUserMemoriesResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isMemorySettings(candidate.settings) &&
    Array.isArray(candidate.memories) &&
    candidate.memories.every(isUserMemory)
  );
}

export async function listUserMemories(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ListUserMemoriesResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-memories`, {
      method: "GET",
      headers: headers(token),
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
  if (!isListUserMemoriesResponse(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body };
}

export async function createUserMemory(
  token: string | undefined,
  input: CreateUserMemoryRequest,
  options: ClientOptions = {},
): Promise<CreateUserMemoryResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-memories`, {
      method: "POST",
      headers: headers(token, true),
      body: JSON.stringify(input),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 422) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "validation_error", message: payload.error ?? "invalid_user_memory_request" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    !("memory" in body) ||
    !isUserMemory((body as { memory?: unknown }).memory)
  ) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body as CreateUserMemoryResponse };
}

export async function deleteUserMemory(
  token: string | undefined,
  id: string,
  options: ClientOptions = {},
): Promise<DeleteUserMemoryResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-memories/${id}`, {
      method: "DELETE",
      headers: headers(token),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { deleted?: unknown }).deleted !== true
  ) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body as DeleteUserMemoryResponse };
}

export async function updateMemorySettings(
  token: string | undefined,
  input: UpdateMemorySettingsRequest,
  options: ClientOptions = {},
): Promise<UpdateMemorySettingsResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-memories/settings`, {
      method: "PATCH",
      headers: headers(token, true),
      body: JSON.stringify(input),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isMemorySettings(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body };
}
