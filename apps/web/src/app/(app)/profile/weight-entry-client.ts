import "server-only";

/**
 * Pure API client for the `/weight-entries` endpoints
 * (17c-profile-body-metrics, PR 2).
 *
 * Mirrors `profile-form-client.ts`'s calling convention exactly: an
 * injectable `fetch` for unit testing, the same Bearer-token
 * server-to-server call shape, and a discriminated result envelope. The
 * browser NEVER calls the API directly — client components invoke the
 * server action in `weight-entry-actions.ts`.
 */
import type { CreateWeightEntryResponse, WeightEntryDTO } from "@kinora/contracts";

export type { CreateWeightEntryResponse, WeightEntryDTO };

export type ListWeightEntriesResult =
  | { kind: "ok"; entries: WeightEntryDTO[] }
  | { kind: "error"; message: string };

export type CreateWeightEntryResult =
  | { kind: "ok"; entry: WeightEntryDTO; wasFirstEntry: boolean }
  | { kind: "validation_error"; message: string }
  | { kind: "error"; message: string };

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function isWeightEntryDTO(value: unknown): value is WeightEntryDTO {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.weightKg === "number" &&
    typeof v.recordedAt === "string"
  );
}

function isListResponse(body: unknown): body is { entries: WeightEntryDTO[] } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.entries) && b.entries.every(isWeightEntryDTO);
}

function isCreateResponse(body: unknown): body is CreateWeightEntryResponse {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return isWeightEntryDTO(b.entry) && typeof b.wasFirstEntry === "boolean";
}

/**
 * Fetch the authenticated user's weight entries via `GET /weight-entries`
 * (newest `recordedAt` first, capped at 100 by the API).
 */
export async function fetchWeightEntries(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ListWeightEntriesResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/weight-entries`, {
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
  if (!isListResponse(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", entries: body.entries };
}

/**
 * Create one weight entry via `POST /weight-entries`. `recordedAt` is
 * optional — the API defaults to `now()` when omitted. Returns
 * `validation_error` on a 422 (non-positive/out-of-range weight, an
 * unparseable or future `recordedAt`), surfacing the API's error code.
 */
export async function createWeightEntry(
  token: string | undefined,
  input: { weightKg: number; recordedAt?: string },
  options: ClientOptions = {},
): Promise<CreateWeightEntryResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  const body: Record<string, unknown> = { weightKg: input.weightKg };
  if (input.recordedAt !== undefined) body.recordedAt = input.recordedAt;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/weight-entries`, {
      method: "POST",
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
  if (!isCreateResponse(responseBody)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", entry: responseBody.entry, wasFirstEntry: responseBody.wasFirstEntry };
}
