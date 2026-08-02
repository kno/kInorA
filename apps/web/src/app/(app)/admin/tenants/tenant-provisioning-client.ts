import "server-only";

/**
 * Pure API client for the admin tenant-provisioning endpoints (GH #307).
 *
 * Extracted from the server/client components so the fetch + result-mapping
 * logic is unit-testable without Next.js framework imports. Mirrors
 * `ai-config-client.ts`.
 *
 * server-only: reads `process.env.API_BASE_URL` (the internal Docker address)
 * and must never be imported by client components. Client-safe types live in
 * `tenant-provisioning-constants.ts`.
 */

import {
  type FetchStatusResult,
  type GrantableTier,
  type GrantOverrideRequest,
  type GrantResult,
  type RevokeResult,
  type SearchTenantsResult,
  type TenantOverrideStatus,
  type TenantSummary,
} from "./tenant-provisioning-constants";

export type {
  FetchStatusResult,
  GrantableTier,
  GrantOverrideRequest,
  GrantResult,
  RevokeResult,
  SearchTenantsResult,
  TenantOverrideStatus,
  TenantSummary,
};

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

type ClientOptions = { apiBaseUrl?: string; fetchImpl?: typeof fetch };

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Search tenants by name (or exact UUID) via GET /admin/tenants. */
export async function searchTenants(
  token: string | undefined,
  query: string,
  options: ClientOptions = {},
): Promise<SearchTenantsResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const url = `${base}/admin/tenants?query=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      headers: authHeaders(token),
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 422) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as { tenants: TenantSummary[] };
    return { kind: "ok", tenants: body.tenants ?? [] };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/** Read one tenant's provisioning state via GET /admin/tenants/:id/tier-override. */
export async function fetchTenantOverrideStatus(
  token: string | undefined,
  tenantId: string,
  options: ClientOptions = {},
): Promise<FetchStatusResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/tenants/${tenantId}/tier-override`, {
      headers: authHeaders(token),
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 422) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as TenantOverrideStatus;
    return { kind: "ok", status: body };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/** Grant a tier override via POST /admin/tenants/:id/tier-override. */
export async function grantTierOverride(
  token: string | undefined,
  tenantId: string,
  input: GrantOverrideRequest,
  options: ClientOptions = {},
): Promise<GrantResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/tenants/${tenantId}/tier-override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(token),
      },
      body: JSON.stringify(input),
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 409) return { kind: "conflict" };
    if (res.status === 422) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    return { kind: "ok" };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/** Revoke the active tier override via POST /admin/tenants/:id/tier-override/revoke. */
export async function revokeTierOverride(
  token: string | undefined,
  tenantId: string,
  options: ClientOptions = {},
): Promise<RevokeResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/tenants/${tenantId}/tier-override/revoke`, {
      method: "POST",
      headers: authHeaders(token),
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 409) return { kind: "conflict" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    return { kind: "ok" };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}
