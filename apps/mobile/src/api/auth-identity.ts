/**
 * `GET /auth/identity` client (Phase 5 mobile offline, 09b-v1).
 *
 * Mobile calls the API directly and already holds the Bearer token (unlike
 * web, which has no client-visible tenantId/userId and must derive identity
 * via a Server Action calling this SAME endpoint — see the design's
 * `getOfflineIdentityKeyAction`). Mirrors `workout-session.ts`'s client
 * shape/conventions (lazy `defaultGetToken` import, injectable
 * `fetchImpl`/`apiBaseUrl`/`getToken` for tests).
 *
 * Returns the caller's stable `(tenantId, userId)` — `identity.ts` hashes
 * these into an opaque, context-prefixed `identityKey`; this client never
 * persists the raw values itself.
 */

async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

export type AuthIdentityResult =
  | { kind: "ok"; tenantId: string; userId: string }
  | { kind: "error"; message: string };

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function getAuthIdentity(
  options: ClientOptions = {},
): Promise<AuthIdentityResult> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/identity`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    return { kind: "error", message: "auth_identity_request_failed" };
  }

  const payload = (await res.json().catch(() => null)) as
    | { tenantId?: string; userId?: string }
    | null;
  if (!payload?.tenantId || !payload.userId) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", tenantId: payload.tenantId, userId: payload.userId };
}
