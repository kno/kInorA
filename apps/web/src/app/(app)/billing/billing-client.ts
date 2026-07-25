import "server-only";

import type {
  BillingCycle,
  BillingPricingDTO,
  BillingVisibilityDTO,
  InvoiceDTO,
} from "@kinora/contracts";
import type {
  GetBillingInvoicesResult,
  GetBillingPricingResult,
  GetBillingVisibilityResult,
  OpenPortalResult,
  StartCheckoutResult,
} from "./billing-types";

// Re-export the client-safe result types so existing importers keep working.
export type {
  GetBillingInvoicesResult,
  GetBillingPricingResult,
  GetBillingVisibilityResult,
  OpenPortalResult,
  StartCheckoutResult,
} from "./billing-types";

interface ClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

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

function isBillingCyclePriceDTO(value: unknown, cycle: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c.cycle === cycle &&
    typeof c.amountPerMonth === "number" &&
    typeof c.amountPerInterval === "number"
  );
}

function isBillingPricingDTO(value: unknown): value is BillingPricingDTO {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.currency === "string" &&
    typeof c.annualSavePercent === "number" &&
    isBillingCyclePriceDTO(c.monthly, "monthly") &&
    isBillingCyclePriceDTO(c.annual, "annual")
  );
}

function isInvoiceDTO(value: unknown): value is InvoiceDTO {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.amountDue === "number" &&
    typeof c.currency === "string" &&
    typeof c.status === "string" &&
    typeof c.createdAt === "string" &&
    (c.hostedInvoiceUrl === null || typeof c.hostedInvoiceUrl === "string") &&
    (c.receiptUrl === null || typeof c.receiptUrl === "string")
  );
}

/**
 * Fetch the config-driven display pricing (`GET /billing/pricing`, 11b Slice 5).
 * The billing screen renders displayed amounts + the save badge from this
 * response — the web never hardcodes prices. Server-only: the session token is
 * never exposed to the client bundle.
 */
export async function getBillingPricing(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<GetBillingPricingResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/billing/pricing`, {
      method: "GET",
      headers: headers(token),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    logReadFailure("pricing_api_unreachable");
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    if (res.status >= 500) logReadFailure("pricing_server_error", { status: res.status });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isBillingPricingDTO(body)) {
    logReadFailure("pricing_invalid_response");
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", data: body };
}

/**
 * Fetch the tenant's invoice history (`GET /billing/invoices`, 11b Slice 4 —
 * OWNER-ONLY). A 403 means the caller is not an owner and maps to `forbidden`
 * (an expected, non-error outcome the UI uses to hide the owner-only sections),
 * NOT to a read-failure log. Server-only: the session token is never exposed to
 * the client bundle.
 */
export async function getBillingInvoices(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<GetBillingInvoicesResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/billing/invoices`, {
      method: "GET",
      headers: headers(token),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    logReadFailure("invoices_api_unreachable");
    return { kind: "error", message: "api_unreachable" };
  }

  // 403 = not an owner. Expected authorization outcome, not a failure.
  if (res.status === 403) return { kind: "forbidden" };

  if (!res.ok) {
    if (res.status >= 500) logReadFailure("invoices_server_error", { status: res.status });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body) || !body.every(isInvoiceDTO)) {
    logReadFailure("invoices_invalid_response");
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", invoices: body };
}

function jsonHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/**
 * Start a Stripe-hosted checkout for the selected cycle (`POST /billing/checkout`,
 * 11b Slice 3). The tenant is bound server-side from the session — never from
 * the body. Returns the hosted URL for the client to redirect to. Server-only:
 * the session token never reaches the client bundle.
 */
export async function startCheckout(
  token: string | undefined,
  cycle: BillingCycle,
  promotionCode: string | undefined,
  options: ClientOptions = {},
): Promise<StartCheckoutResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const payload: { cycle: BillingCycle; promotionCode?: string } = { cycle };
  if (promotionCode && promotionCode.trim() !== "") payload.promotionCode = promotionCode.trim();

  let res: Response;
  try {
    res = await fetchImpl(`${base}/billing/checkout`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: errBody.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!body || typeof body.url !== "string") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", url: body.url };
}

/**
 * Open the Stripe Customer Portal (`POST /billing/portal`, 11b Slice 4 —
 * OWNER-ONLY). A 403 maps to `forbidden` (non-owner), mirroring the invoice
 * read. Server-only: the session token never reaches the client bundle.
 */
export async function openPortal(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<OpenPortalResult> {
  if (!token) return { kind: "error", message: "no_session" };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/billing/portal`, {
      method: "POST",
      headers: jsonHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 403) return { kind: "forbidden" };

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: errBody.error ?? `api_error_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!body || typeof body.url !== "string") {
    return { kind: "error", message: "invalid_response" };
  }
  return { kind: "ok", url: body.url };
}
