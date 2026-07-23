import "server-only";

import type { BillingVisibilityDTO } from "@kinora/contracts";

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export type GetBillingVisibilityResult =
  | { kind: "ok"; data: BillingVisibilityDTO }
  | { kind: "error"; message: string };

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function headers(token: string | undefined): HeadersInit {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function isTenantBillingStateDTO(value: unknown): value is BillingVisibilityDTO["billing"] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenantId === "string" &&
    typeof candidate.tier === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.source === "string" &&
    (candidate.trialStartedAt === null || typeof candidate.trialStartedAt === "string") &&
    (candidate.trialEndsAt === null || typeof candidate.trialEndsAt === "string") &&
    (candidate.activeOverrideEndsAt === null || typeof candidate.activeOverrideEndsAt === "string") &&
    typeof candidate.updatedAt === "string"
  );
}

// FIX 6 (review correction): validate each usage row's shape, not just that
// the array exists — a malformed/partial row (e.g. a missing or wrong-typed
// field) must route to invalid_response instead of rendering as
// "undefined/undefined used".
function isUsageRowShape(value: unknown): value is { feature: string; period: string; used: number; limit: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.feature === "string" &&
    typeof candidate.period === "string" &&
    typeof candidate.used === "number" &&
    typeof candidate.limit === "number"
  );
}

function isMemberUsageRowShape(value: unknown): boolean {
  return (
    isUsageRowShape(value) &&
    typeof (value as Record<string, unknown>).userId === "string"
  );
}

function isBillingVisibilityDTO(value: unknown): value is BillingVisibilityDTO {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantBillingStateDTO(candidate.billing) &&
    Array.isArray(candidate.tenantUsage) &&
    candidate.tenantUsage.every(isUsageRowShape) &&
    Array.isArray(candidate.memberUsage) &&
    candidate.memberUsage.every(isMemberUsageRowShape)
  );
}

// FIX 4 (review correction): a hung API stalls the SSR fetch up to undici's
// ~300s default with no signal. Bound the wait so a slow/hung API maps
// quickly to the existing api_unreachable/error Result instead.
const FETCH_TIMEOUT_MS = 5_000;

// #176 — emit a structured server-side telemetry line when a billing-visibility
// read fails. This module is `server-only`, so `console.error` lands on the
// Next.js server stdout (the app's logging convention; see i18n/request.ts).
// The payload carries the failure kind and minimal context ONLY — never the
// session token or any response body content. A 4xx business denial (e.g.
// inactive_membership) is an expected outcome, not a read failure, and is NOT
// logged here.
const READ_FAILURE_EVENT = "billing_visibility_read_failed";

function logReadFailure(kind: string, context: Record<string, unknown> = {}): void {
  console.error({ event: READ_FAILURE_EVENT, kind, ...context });
}

/**
 * Fetch the member-facing billing visibility read (spec `Billing State
 * Visibility`, Phase 4). Backed by `GET /billing/visibility` (Phase 4,
 * apps/api/src/routes/billing.ts) — available to any active member of the
 * caller's own tenant, unlike the owner-only `GET /billing/usage`.
 */
export async function getBillingVisibility(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<GetBillingVisibilityResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/billing/visibility`, {
      method: "GET",
      headers: headers(token),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    logReadFailure("api_unreachable");
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    if (res.status >= 500) {
      logReadFailure("server_error", { status: res.status });
    }
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isBillingVisibilityDTO(body)) {
    logReadFailure("invalid_response");
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body };
}
