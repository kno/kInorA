import "server-only";

/**
 * Pure API client for the user-profile endpoints (Slice 4 of
 * 10a-user-memory-structured).
 *
 * Extracted from the Server Actions / page server component so the API-call +
 * result-mapping logic is unit-testable with an injectable `fetch` (no Next.js
 * framework imports). Mirrors the `ai-config-client.ts` / `stats-client.ts`
 * pattern.
 *
 * The browser NEVER calls the API directly: client components invoke the
 * server actions in `actions.ts`, which read the opaque `kinora_session`
 * httpOnly cookie and forward it as a Bearer token to the API
 * server-to-server. The session token stays server-side.
 *
 * This module is server-only: it reads `process.env.API_BASE_URL` (the
 * internal Docker address `http://api:4000`) and must never be imported by
 * client components.
 */
import type {
  UserProfile,
  PlanGoal,
  ExperienceLevel,
} from "@kinora/contracts";

export type { UserProfile, PlanGoal, ExperienceLevel };

/** Common subset of `UpdateProfileRequest` with nullable selectors. */
export interface ProfileFormInput {
  /** Required, non-blank. */
  name: string;
  /** `null` means "leave the stored value unchanged" → field is omitted. */
  goal: PlanGoal | null;
  /** `null` means "leave the stored value unchanged" → field is omitted. */
  experienceLevel: ExperienceLevel | null;
}

export type GetProfileResult =
  | { kind: "ok"; profile: UserProfile }
  | { kind: "error"; message: string };

export type SaveProfileResult =
  | { kind: "ok"; profile: UserProfile }
  | { kind: "validation_error"; message: string }
  | { kind: "error"; message: string };

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

/**
 * Narrow an unknown API body to a {@link UserProfile}. Defensive — the API is
 * trusted but a malformed/partial body must never crash the form.
 */
function isUserProfile(body: unknown): body is UserProfile {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.userId === "string" &&
    typeof b.name === "string" &&
    (b.goal === null || typeof b.goal === "string") &&
    (b.experienceLevel === null || typeof b.experienceLevel === "string")
  );
}

/**
 * Fetch the authenticated user's profile via `GET /user-profile`. The endpoint
 * lazily provisions a default row on first read, so a 200 is always expected
 * for an authenticated user; non-2xx is surfaced as an error.
 */
export async function fetchUserProfile(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<GetProfileResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-profile`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      kind: "error",
      message: payload.error ?? `api_error_${res.status}`,
    };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isUserProfile(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", profile: body };
}

/**
 * Persist the profile via `PUT /user-profile`. Omitted `goal`/
 * `experienceLevel` (passed as `null`) leave the stored values unchanged —
 * partial-merge semantics live in the API route. Returns `validation_error`
 * on a 422 (blank name / invalid enum), surfacing the API's error code.
 */
export async function updateUserProfile(
  token: string | undefined,
  input: ProfileFormInput,
  options: ClientOptions = {},
): Promise<SaveProfileResult> {
  if (!token) return { kind: "error", message: "no_session" };

  // Guard at the edge too: a blank name never reaches the API.
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return { kind: "validation_error", message: "name_required" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  // Build the partial body — omit null selectors so the route preserves them.
  const body: Record<string, unknown> = { name: input.name };
  if (input.goal !== null) body.goal = input.goal;
  if (input.experienceLevel !== null) body.experienceLevel = input.experienceLevel;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-profile`, {
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
    return {
      kind: "validation_error",
      message: payload.error ?? "invalid_payload",
    };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      kind: "error",
      message: payload.error ?? `api_error_${res.status}`,
    };
  }

  const responseBody = (await res.json().catch(() => null)) as unknown;
  if (!isUserProfile(responseBody)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", profile: responseBody };
}