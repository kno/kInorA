/**
 * Mobile user-profile API client (17c-profile-body-metrics, PR 5).
 *
 * Mirrors the web app's `profile-form-client.ts` (`GET`/`PUT /user-profile`,
 * same partial-merge semantics: a `null` selector leaves the stored value
 * unchanged) adapted to the mobile runtime: the session token comes from
 * Expo SecureStore, not an httpOnly cookie, and mobile calls the API
 * DIRECTLY rather than through a Next.js Server Action — there is no
 * server-only boundary to hide a token behind on this platform.
 *
 * DTOs are imported from `@kinora/contracts` — no local redefinition of the
 * shared shapes.
 *
 * Endpoints:
 *   GET /user-profile         → 200 UserProfile
 *   PUT /user-profile {…}     → 200 UserProfile | 422 { error }
 */
import type {
  ExperienceLevel,
  PlanGoal,
  SelfDescribedSex,
  UserProfile,
} from "@kinora/contracts";

/**
 * Default token source. Imported lazily so this module's graph does not pull
 * in `expo-secure-store` (and, transitively, React Native's Flow-typed entry)
 * at import time — that keeps the client unit-testable under vitest, where a
 * `getToken` override is always injected. Mirrors `plan-status-client.ts`.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

export interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Override the token source (defaults to SecureStore) — for tests. */
  getToken?: () => Promise<string | null>;
}

export type GetProfileResult =
  | { kind: "ok"; profile: UserProfile }
  | { kind: "error"; message: string };

export type SaveProfileResult =
  | { kind: "ok"; profile: UserProfile }
  | { kind: "validation_error"; message: string }
  | { kind: "error"; message: string };

/**
 * `null` on `goal`/`experienceLevel`/`selfDescribedSex`/`heightCm` means
 * "leave the stored value unchanged" — the same three-way semantics the
 * API route already applies (undefined-on-the-wire preserves, `null` on the
 * wire unsets, a value stores). This client omits a `null` field from the
 * request body entirely, which is what produces "preserve" at the route.
 */
export interface ProfileFormInput {
  /** Required, non-blank. */
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
  selfDescribedSex: SelfDescribedSex | null;
  heightCm: number | null;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

/**
 * Narrow an unknown API body to a {@link UserProfile}. Defensive — the API
 * is trusted but a malformed/partial body must never crash the screen.
 */
function isUserProfile(body: unknown): body is UserProfile {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.userId === "string" &&
    typeof b.name === "string" &&
    (b.goal === null || typeof b.goal === "string") &&
    (b.experienceLevel === null || typeof b.experienceLevel === "string") &&
    (b.selfDescribedSex === null || typeof b.selfDescribedSex === "string") &&
    (b.heightCm === null || typeof b.heightCm === "number")
  );
}

/**
 * Fetch the authenticated user's profile via `GET /user-profile`. The
 * endpoint lazily provisions a default row on first read, so a 200 is
 * always expected for an authenticated user; non-2xx is surfaced as an
 * error.
 */
export async function fetchUserProfile(
  options: ClientOptions = {},
): Promise<GetProfileResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/user-profile`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isUserProfile(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", profile: body };
}

/**
 * Persist the profile via `PUT /user-profile`. Omitted `goal`/
 * `experienceLevel`/`selfDescribedSex`/`heightCm` (passed as `null`) leave
 * the stored values unchanged — partial-merge semantics live in the API
 * route, never re-implemented here. Returns `validation_error` on a 422
 * (blank name / invalid enum / out-of-range height), surfacing the API's
 * error code UNCHANGED — this client does not duplicate the API's
 * validation rules (the enum members and the `[50, 300]` height bound live
 * at the route only).
 */
export async function updateUserProfile(
  input: ProfileFormInput,
  options: ClientOptions = {},
): Promise<SaveProfileResult> {
  const token = await (options.getToken ?? defaultGetToken)();
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
  if (input.selfDescribedSex !== null) body.selfDescribedSex = input.selfDescribedSex;
  if (input.heightCm !== null) body.heightCm = input.heightCm;

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
    return { kind: "validation_error", message: payload.error ?? "invalid_payload" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const responseBody = (await res.json().catch(() => null)) as unknown;
  if (!isUserProfile(responseBody)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", profile: responseBody };
}
